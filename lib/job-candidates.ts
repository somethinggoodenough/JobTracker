import type { JobRecord, SourceRecord } from "./job-types";
import { classificationKey, type createJobClassifier } from "./job-classifier";
import { isCrawlCandidate } from "./crawl-policy";
import type { ScreeningRules } from "./screening-defaults";

const freshnessOrder = (row: "job_candidates" | "excluded") => `CASE json_extract(${row}.payload_json,'$.freshness.freshness')
  WHEN 'published' THEN 4 WHEN 'new' THEN 3 WHEN 'uncertain' THEN 2 WHEN 'baseline' THEN 1 ELSE 0 END`;

export type ClaimedCandidate = { id: number; source_id: number; content_hash: string; payload_json: string; first_seen_at: string };

export function claimCandidate(db: D1Database, runId: number, now = new Date().toISOString()) {
  return db.prepare(`UPDATE job_candidates SET claim_run_id=?1 WHERE id=(
    SELECT id FROM job_candidates WHERE claim_run_id IS NULL AND expires_at>?2 AND next_retry_at<=?2
    ORDER BY substr(expires_at,1,10),priority DESC,first_seen_at,id LIMIT 1)
    AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND status='running') RETURNING
    id,source_id,content_hash,payload_json,first_seen_at`).bind(runId, now).first<ClaimedCandidate>();
}

// Stale queue entries are skipped, not rejected as ineligible jobs: approved
// historical records must keep their original seven-day retention.
export async function reviewCurrentCandidate(classifier: ReturnType<typeof createJobClassifier>, job: JobRecord) {
  if (!isCrawlCandidate(job.postedAt, job.dateKind)) { classifier.metrics.ruleRejected++; return null; }
  return classifier.evaluate(job);
}
export async function candidateWrite(db: D1Database, source: SourceRecord, job: JobRecord, url: string, dedupe: string,
  firstSeen: string, expiresAt: string, priority: number, model: string, settings?: ScreeningRules) {
  const now = new Date().toISOString(), hash = await classificationKey(job, model, undefined, settings);
  return db.prepare(`INSERT INTO job_candidates(source_id,canonical_url,dedupe_key,content_hash,payload_json,priority,first_seen_at,last_seen_at,expires_at,next_retry_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?8)
    ON CONFLICT DO UPDATE SET source_id=excluded.source_id,payload_json=CASE WHEN
      (${freshnessOrder("job_candidates")})>(${freshnessOrder("excluded")})
      THEN json_set(excluded.payload_json,'$.freshness',json_extract(job_candidates.payload_json,'$.freshness'))
      ELSE excluded.payload_json END,
      priority=excluded.priority,last_seen_at=excluded.last_seen_at,
      first_seen_at=MIN(job_candidates.first_seen_at,excluded.first_seen_at),expires_at=excluded.expires_at,
      next_retry_at=CASE WHEN job_candidates.content_hash<>excluded.content_hash THEN excluded.next_retry_at ELSE job_candidates.next_retry_at END,
      last_error=CASE WHEN job_candidates.content_hash<>excluded.content_hash THEN NULL ELSE job_candidates.last_error END,
      content_hash=excluded.content_hash`).bind(source.id, url, dedupe, hash, JSON.stringify(job), priority, firstSeen, now, expiresAt);
}
export function candidateDelete(db: D1Database, url: string, dedupe: string) {
  return db.prepare("DELETE FROM job_candidates WHERE canonical_url=?1 OR dedupe_key=?2").bind(url, dedupe);
}
