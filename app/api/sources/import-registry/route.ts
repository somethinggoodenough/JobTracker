import { getD1 } from "@/lib/database";
import { normalizeSource } from "@/lib/crawler";
import registry from "@/data/source-registry.json";
import { companyProfile } from "@/lib/company-crawlers";
import type { SourceRecord } from "@/lib/job-types";

export async function POST() {
  const db = getD1();
  const now = new Date().toISOString();
  let imported = 0;
  for (const item of registry) {
    const profile = companyProfile(item);
    const normalized = normalizeSource(profile?.url ?? item.url, (profile?.adapter ?? "auto") as SourceRecord["adapter"]);
    const existing = await db.prepare("SELECT id,url FROM sources WHERE name=?1 LIMIT 1").bind(item.name).first<{ id: number; url: string }>();
    if (existing && existing.url !== normalized.canonicalInput) {
      // A corrected career URL must not destroy saved jobs or candidate history.
      await db.prepare("UPDATE sources SET url=?1,adapter=?2,enabled=0,last_error=?3,updated_at=?4 WHERE id=?5")
        .bind(normalized.canonicalInput, normalized.adapter, "招聘入口已更新，等待实际验证", now, existing.id).run();
    }
  }
  for (let i = 0; i < registry.length; i += 40) {
    const statements = registry.slice(i, i + 40).map((item) => {
      const provider = item.kind === "provider";
      const profile = companyProfile(item);
      const normalized = normalizeSource(profile?.url ?? item.url, (profile?.adapter ?? "auto") as SourceRecord["adapter"]);
      const reason = provider ? item.note ?? "ATS 平台本身不是单一职位源" : "等待实际抓取验证";
      return db.prepare(`INSERT INTO sources (name,url,adapter,enabled,last_error,created_at,updated_at)
        VALUES (?1,?2,?3,0,?4,?5,?5)
        ON CONFLICT(url) DO UPDATE SET name=excluded.name,adapter=excluded.adapter,
        enabled=CASE WHEN sources.last_success_at IS NOT NULL THEN sources.enabled ELSE 0 END,
        last_error=CASE WHEN sources.last_success_at IS NOT NULL THEN sources.last_error ELSE excluded.last_error END,
        updated_at=excluded.updated_at`)
        .bind(item.name, normalized.canonicalInput, normalized.adapter, reason, now);
    });
    const results = await db.batch(statements);
    imported += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
  }
  return Response.json({ total: registry.length, imported });
}
