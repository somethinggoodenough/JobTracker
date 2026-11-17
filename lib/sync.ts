import { crawlSource } from "./crawler";
import { getD1 } from "./database";
import type { JobRecord, SourceRecord, SyncSummary } from "./job-types";

const DAY = 86_400_000;
const normalize = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|source$|ref$|gh_src$)/i.test(key)) url.searchParams.delete(key);
    });
    return url.toString().replace(/\/$/, "");
  } catch { return value.trim(); }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validDate(value: string | null | undefined, fallback: string) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

async function upsertJob(db: D1Database, source: SourceRecord, job: JobRecord, now: string, cutoff: number) {
  const postedAt = validDate(job.postedAt, now);
  if (Date.parse(postedAt) <= cutoff) return "ignored" as const;
  const url = canonicalUrl(job.canonicalUrl || job.applyUrl || source.url);
  const sourceKey = `${source.id}:${normalize(job.externalId || url)}`;
  const dedupeKey = await sha256([
    normalize(job.company || source.name), normalize(job.title), normalize(job.location),
    normalize(job.department), normalize(job.employmentType),
  ].join("|"));

  const existing = await db.prepare(
    "SELECT id FROM jobs WHERE source_external_key = ?1 OR canonical_url = ?2 OR dedupe_key = ?3 LIMIT 1"
  ).bind(sourceKey, url, dedupeKey).first<{ id: number }>();
  const values = [source.id, sourceKey, dedupeKey, url, job.applyUrl || url, job.company || source.name,
    job.title, job.location || "未注明", job.workplaceType || null, job.employmentType || null,
    job.department || null, job.salary || null, job.description || "", postedAt, now, now];

  if (existing) {
    await db.prepare(`UPDATE jobs SET source_id=?1, source_external_key=?2, dedupe_key=?3,
      canonical_url=?4, apply_url=?5, company=?6, title=?7, location=?8, workplace_type=?9,
      employment_type=?10, department=?11, salary=?12, description=?13, posted_at=?14,
      last_seen_at=?15, updated_at=?16 WHERE id=?17`).bind(...values, existing.id).run();
    return "updated" as const;
  }
  await db.prepare(`INSERT INTO jobs (source_id, source_external_key, dedupe_key, canonical_url,
    apply_url, company, title, location, workplace_type, employment_type, department, salary,
    description, posted_at, first_seen_at, last_seen_at, updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)`).bind(...values).run();
  return "added" as const;
}

export async function runSync(): Promise<SyncSummary> {
  const db = getD1();
  const now = new Date().toISOString();
  const cutoff = Date.now() - 7 * DAY;
  const deleted = await db.prepare("DELETE FROM jobs WHERE posted_at <= ?1")
    .bind(new Date(cutoff).toISOString()).run();
  const sources = await db.prepare("SELECT id, name, url, adapter FROM sources WHERE enabled = 1 ORDER BY id")
    .all<SourceRecord>();
  const run = await db.prepare(`INSERT INTO scrape_runs (status, started_at, sources_total, jobs_deleted)
    SELECT 'running', ?1, ?2, ?3 WHERE NOT EXISTS (
      SELECT 1 FROM scrape_runs WHERE status='running' AND started_at > ?4
    )`).bind(now, sources.results.length, deleted.meta.changes ?? 0,
      new Date(Date.now() - 30 * 60_000).toISOString()).run();
  if (!run.meta.changes) throw new Error("另一次同步仍在进行，请稍后再试");
  const runId = Number(run.meta.last_row_id);
  let succeeded = 0, seen = 0, added = 0, updated = 0;
  const errors: string[] = [];

  for (const source of sources.results) {
    try {
      const jobs = await crawlSource(source);
      for (const job of jobs) {
        if (!job.title || !job.canonicalUrl) continue;
        seen += 1;
        const result = await upsertJob(db, source, job, now, cutoff);
        if (result === "added") added += 1;
        if (result === "updated") updated += 1;
      }
      succeeded += 1;
      await db.prepare("UPDATE sources SET last_success_at=?1, last_error=NULL, updated_at=?1 WHERE id=?2")
        .bind(now, source.id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${source.name}: ${message}`);
      await db.prepare("UPDATE sources SET last_error=?1, updated_at=?2 WHERE id=?3")
        .bind(message.slice(0, 500), now, source.id).run();
    }
  }

  const status = errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "failed";
  await db.prepare(`UPDATE scrape_runs SET status=?1, finished_at=?2, sources_succeeded=?3,
    jobs_seen=?4, jobs_added=?5, jobs_updated=?6, error_summary=?7 WHERE id=?8`)
    .bind(status, new Date().toISOString(), succeeded, seen, added, updated,
      errors.join("\n").slice(0, 4000) || null, runId).run();
  return { runId, status, sourcesTotal: sources.results.length, sourcesSucceeded: succeeded,
    jobsSeen: seen, jobsAdded: added, jobsUpdated: updated,
    jobsDeleted: deleted.meta.changes ?? 0, errors };
}
