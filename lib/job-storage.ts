import type { JobRecord, SourceRecord } from "./job-types";
import { AI_POLICY, type JobDecision } from "./classification-types";
import { AwaitingClassification, createJobClassifier } from "./job-classifier";
import { enqueueCandidate, rememberFirstSeen, clearCandidate } from "./job-candidates";
import { hasPublicationDate } from "./crawl-policy";
import { isInCrawlWindow, publicationTime } from "./crawl-window";
import { throwIfSyncCancelled } from "./sync-control";
const DAY = 86_400_000;
const normalize = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

export function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    // Moka and other SPA boards put the posting identity in the route fragment.
    if (!/^#\/(?:job\/|campus\/)/.test(url.hash)) url.hash = "";
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

export async function seedDiscoveries(db: D1Database) {
  const rows = await db.prepare(`SELECT canonical_url,dedupe_key,first_seen_at FROM jobs j WHERE NOT EXISTS
    (SELECT 1 FROM job_discoveries d WHERE d.identity='fingerprint:'||j.dedupe_key)`).all<{ canonical_url: string; dedupe_key: string; first_seen_at: string }>();
  for (let offset=0;offset<rows.results.length;offset+=40) {
    const entries = await Promise.all(rows.results.slice(offset,offset+40).map(async row => [
      { identity: `url:${await sha256(canonicalUrl(row.canonical_url))}`, firstSeen: row.first_seen_at },
      { identity: `fingerprint:${row.dedupe_key}`, firstSeen: row.first_seen_at },
    ]));
    await db.batch(entries.flat().map(entry => db.prepare("INSERT OR IGNORE INTO job_discoveries(identity,first_seen_at) VALUES(?1,?2)").bind(entry.identity,entry.firstSeen)));
  }
}

export async function upsertJob(db: D1Database, source: SourceRecord, job: JobRecord, now: string, cutoff: number, classifier: ReturnType<typeof createJobClassifier>, model: string,
  approved?: JobDecision, originalFirstSeen?: string, historical = false) {
  throwIfSyncCancelled();
  const url = canonicalUrl(job.canonicalUrl || job.applyUrl || source.url);
  const sourceKey = `${source.id}:${normalize(job.externalId || url)}`;
  const time = publicationTime(job.postedAt);
  let postedAt = Number.isFinite(time) ? new Date(time).toISOString() : now;
  if (Number.isFinite(time) && Date.parse(postedAt) <= cutoff) {
    // Correct older records if a newly integrated API supplies their original publication date.
    const removed = await db.prepare("DELETE FROM jobs WHERE source_external_key=?1 OR canonical_url=?2").bind(sourceKey, url).run();
    return { state: "ignored" as const, deleted: removed.meta.changes ?? 0 };
  }
  if (!historical && hasPublicationDate(job.postedAt) && !isInCrawlWindow(job.postedAt)) return { state: "ignored" as const, deleted: 0 };
  const dedupeKey = await sha256([
    normalize(job.company || source.name), normalize(job.title), normalize(job.location),
    normalize(job.department), normalize(job.employmentType),
  ].join("|"));
  throwIfSyncCancelled();

  const existing = await db.prepare(
    "SELECT id,posted_at,first_seen_at,publication_verified FROM jobs WHERE source_external_key = ?1 OR canonical_url = ?2 OR dedupe_key = ?3 LIMIT 1"
  ).bind(sourceKey, url, dedupeKey).first<{ id: number; posted_at: string; first_seen_at: string; publication_verified: number }>();
  const firstSeen = await rememberFirstSeen(db, [`url:${await sha256(url)}`, `fingerprint:${dedupeKey}`], existing?.first_seen_at || originalFirstSeen || now);
  const verified = hasPublicationDate(job.postedAt) || !!existing?.publication_verified;
  if (!hasPublicationDate(job.postedAt)) postedAt = existing?.publication_verified ? existing.posted_at : firstSeen;
  if (Date.parse(postedAt) <= cutoff) {
    const removed = existing ? await db.prepare("DELETE FROM jobs WHERE id=?1").bind(existing.id).run() : null;
    await clearCandidate(db,url,dedupeKey);
    return { state: "ignored" as const, deleted: removed?.meta.changes ?? 0 };
  }
  let decision: JobDecision;
  try { decision = approved ?? await classifier.evaluate(job, { cacheOnly: true }); }
  catch (error) {
    if (existing) await db.prepare("UPDATE jobs SET ai_policy=NULL WHERE id=?1").bind(existing.id).run();
    if (error instanceof AwaitingClassification) {
      await enqueueCandidate(db, source, job, url, dedupeKey, firstSeen, new Date(Date.parse(postedAt)+7*DAY).toISOString(), error.priority, model, classifier.settings);
      return { state: "queued" as const, deleted: 0 };
    }
    throw error;
  }
  throwIfSyncCancelled();
  if (!decision.accepted) {
    const removed = existing ? await db.prepare("DELETE FROM jobs WHERE id=?1").bind(existing.id).run() : null;
    await clearCandidate(db, url, dedupeKey);
    return { state: "ignored" as const, deleted: removed?.meta.changes ?? 0 };
  }
  const values = [source.id, sourceKey, dedupeKey, url, job.applyUrl || url, job.company || source.name,
    job.title, job.location || "未注明", job.workplaceType || null, job.employmentType || null,
    job.department || null, job.salary || null, job.description || "", postedAt, now, now];
  throwIfSyncCancelled();

  const analysis = [AI_POLICY, JSON.stringify(decision), model, new Date().toISOString()];
  if (existing) {
    await db.prepare(`UPDATE jobs SET source_id=?1, source_external_key=?2, dedupe_key=?3,
      canonical_url=?4, apply_url=?5, company=?6, title=?7, location=?8, workplace_type=?9,
      employment_type=?10, department=?11, salary=?12, description=?13, posted_at=?14,
      last_seen_at=?15, updated_at=?16, publication_verified=?21,
      ai_policy=?17,ai_analysis=?18,ai_model=?19,ai_reviewed_at=?20 WHERE id=?22`).bind(...values, ...analysis, verified ? 1 : 0, existing.id).run();
    await clearCandidate(db, url, dedupeKey);
    return { state: "updated" as const, deleted: 0 };
  }
  await db.prepare(`INSERT INTO jobs (source_id, source_external_key, dedupe_key, canonical_url,
    apply_url, company, title, location, workplace_type, employment_type, department, salary,
    description, posted_at, first_seen_at, last_seen_at, updated_at, publication_verified,ai_policy,ai_analysis,ai_model,ai_reviewed_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?21,?16,?16,?22,?17,?18,?19,?20)`).bind(...values, ...analysis, firstSeen, verified ? 1 : 0).run();
  await clearCandidate(db, url, dedupeKey);
  return { state: "added" as const, deleted: 0 };
}
