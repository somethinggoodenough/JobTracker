import { getD1 } from "@/lib/database";
import { crawlSource } from "@/lib/crawler";
import type { SourceRecord } from "@/lib/job-types";
import { companyProfile } from "@/lib/company-crawlers";

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

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId)) return Response.json({ error: "无效来源" }, { status: 400 });
  const db = getD1();
  const source = await db.prepare("SELECT id,name,url,adapter FROM sources WHERE id=?1").bind(sourceId).first<SourceRecord>();
  if (!source) return Response.json({ error: "来源不存在" }, { status: 404 });
  try {
    const jobs = await crawlSource(source);
    // A valid board may have zero postings today. Empty daily results are healthy.
    const now = new Date().toISOString();
    const profile = companyProfile(source);
    const adapter = profile?.adapter ?? source.adapter;
    const warning = jobs.warnings?.join("\n") || null;
    await db.prepare("UPDATE sources SET enabled=1,last_error=?4,last_success_at=?1,updated_at=?1,adapter=?3,url=?5 WHERE id=?2")
      .bind(now, sourceId, adapter, warning, profile?.url ?? source.url).run();
    return Response.json({ ok: true, empty: !jobs.length, partial: !!warning, warning, id: sourceId, name: source.name, jobs: jobs.length, adapter });
  } catch (error) {
    const message = error instanceof Error ? error.message : "验证失败";
    const profile = companyProfile(source);
    await db.prepare("UPDATE sources SET enabled=0,last_error=?1,updated_at=?2,url=?4,adapter=?5 WHERE id=?3")
      .bind(message.slice(0, 500), new Date().toISOString(), sourceId, profile?.url ?? source.url, profile?.adapter ?? source.adapter).run();
    return Response.json({ ok: false, id: sourceId, name: source.name, error: message }, { status: 422 });
  }
}
