import { getD1 } from "@/lib/database";
import { crawlSource } from "@/lib/crawler";
import type { SourceRecord } from "@/lib/job-types";
import { companyProfile } from "@/lib/company-crawlers";
import { crawlMetrics, crawlPerformance, requestLimiter } from "@/lib/crawl-performance";
import { isWorkdayHost, readWorkdayCooldown, saveWorkdayCooldown, WorkdayRateLimitError, type WorkdayRateLimit } from "@/lib/workday-rate-limit";
import { withSyncSignal } from "@/lib/sync-control";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId)) return Response.json({ error: "无效来源" }, { status: 400 });
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM jobs WHERE source_id=?1").bind(sourceId),
    db.prepare("DELETE FROM sources WHERE id=?1").bind(sourceId),
  ]);
  return Response.json({ ok: true });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId)) return Response.json({ error: "无效来源" }, { status: 400 });
  const db = getD1();
  const source = await db.prepare("SELECT id,name,url,adapter FROM sources WHERE id=?1").bind(sourceId).first<SourceRecord>();
  if (!source) return Response.json({ error: "来源不存在" }, { status: 404 });
  const profile = companyProfile(source);
  const url = profile?.url ?? source.url;
  const workday = URL.canParse(url) && isWorkdayHost(new URL(url).hostname);
  const limited = (cooldown: WorkdayRateLimit) => {
    const wait = cooldown.retryAt === null ? null : Math.max(0, Math.ceil((cooldown.retryAt - Date.now()) / 1000));
    return Response.json({ ok: false, id: sourceId, name: source.name, cooldown, error: `HTTP 429 · ${cooldown.address}` },
      { status: 429, headers: wait === null ? {} : { "Retry-After": String(wait) } });
  };
  if (workday) {
    const cooldown = await readWorkdayCooldown(db);
    if (cooldown) return limited(cooldown);
    const running = await db.prepare(`SELECT 1 FROM scrape_runs WHERE id=(SELECT MAX(id) FROM scrape_runs)
      AND status IN ('running','cancelling')`).first();
    if (running) return Response.json({ error: "同步进行中，完成后再验证 Workday 来源" }, { status: 409 });
  }
  try {
    const jobs = workday ? await withSyncSignal(request.signal, () =>
      crawlPerformance.run({ metrics: crawlMetrics(), limit: requestLimiter(1) }, () => crawlSource(source))) : await crawlSource(source);
    // A valid board may have zero postings today. Empty daily results are healthy.
    const now = new Date().toISOString();
    const adapter = profile?.adapter ?? source.adapter;
    const warning = jobs.warnings?.join("\n") || null;
    await db.prepare("UPDATE sources SET enabled=1,last_error=?4,last_success_at=?1,updated_at=?1,adapter=?3,url=?5 WHERE id=?2")
      .bind(now, sourceId, adapter, warning, url).run();
    return Response.json({ ok: true, empty: !jobs.length, partial: !!warning, warning, id: sourceId, name: source.name, jobs: jobs.length, adapter });
  } catch (error) {
    if (error instanceof WorkdayRateLimitError) {
      await saveWorkdayCooldown(db, error.cooldown);
      return limited(error.cooldown);
    }
    if (workday && request.signal.aborted) return Response.json({ error: "验证已取消" }, { status: 408 });
    const message = error instanceof Error ? error.message : "验证失败";
    await db.prepare("UPDATE sources SET enabled=0,last_error=?1,updated_at=?2,url=?4,adapter=?5 WHERE id=?3")
      .bind(message.slice(0, 500), new Date().toISOString(), sourceId, url, profile?.adapter ?? source.adapter).run();
    return Response.json({ ok: false, id: sourceId, name: source.name, error: message }, { status: 422 });
  }
}
