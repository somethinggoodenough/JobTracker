import type { JobRecord, SourceRecord } from "./job-types";
import { classificationKey, type createJobClassifier } from "./job-classifier";
import { isCrawlCandidate } from "./crawl-policy";
import type { ScreeningRules } from "./screening-defaults";

// Stale queue entries are skipped, not rejected as ineligible jobs: approved
// historical records must keep their original seven-day retention.
export async function reviewCurrentCandidate(classifier: ReturnType<typeof createJobClassifier>, job: JobRecord) {
  if (!isCrawlCandidate(job.postedAt)) { classifier.metrics.ruleRejected++; return null; }
  return classifier.evaluate(job);
}
export async function rememberFirstSeen(db: D1Database, identities: [string,string], proposed: string) {
  const previous = await db.prepare("SELECT MIN(first_seen_at) AS first_seen_at FROM job_discoveries WHERE identity IN (?1,?2)")
    .bind(...identities).first<{ first_seen_at: string | null }>();
  const firstSeen = previous?.first_seen_at && previous.first_seen_at < proposed ? previous.first_seen_at : proposed;
  await db.batch(identities.map(identity => db.prepare(`INSERT INTO job_discoveries(identity,first_seen_at) VALUES(?1,?2)
    ON CONFLICT(identity) DO UPDATE SET first_seen_at=MIN(job_discoveries.first_seen_at,excluded.first_seen_at)`).bind(identity, firstSeen)));
  return firstSeen;
}
export async function enqueueCandidate(db: D1Database, source: SourceRecord, job: JobRecord, url: string, dedupe: string,
  firstSeen: string, expiresAt: string, priority: number, model: string, settings?: ScreeningRules) {
  const now = new Date().toISOString(), hash = await classificationKey(job, model, undefined, settings);
  await db.prepare(`INSERT INTO job_candidates(source_id,canonical_url,dedupe_key,content_hash,payload_json,priority,first_seen_at,last_seen_at,expires_at,next_retry_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?8)
    ON CONFLICT DO UPDATE SET source_id=excluded.source_id,payload_json=excluded.payload_json,
      priority=excluded.priority,last_seen_at=excluded.last_seen_at,
      first_seen_at=MIN(job_candidates.first_seen_at,excluded.first_seen_at),expires_at=excluded.expires_at,
      next_retry_at=CASE WHEN job_candidates.content_hash<>excluded.content_hash THEN excluded.next_retry_at ELSE job_candidates.next_retry_at END,
      last_error=CASE WHEN job_candidates.content_hash<>excluded.content_hash THEN NULL ELSE job_candidates.last_error END,
      content_hash=excluded.content_hash`).bind(source.id, url, dedupe, hash, JSON.stringify(job), priority, firstSeen, now, expiresAt).run();
}
export async function clearCandidate(db: D1Database, url: string, dedupe: string) {
  await db.prepare("DELETE FROM job_candidates WHERE canonical_url=?1 OR dedupe_key=?2").bind(url, dedupe).run();
}
