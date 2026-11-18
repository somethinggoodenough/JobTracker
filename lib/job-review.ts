import { AI_POLICY } from "./classification-types";
import { AwaitingClassification, createJobClassifier } from "./job-classifier";
import { mapPool } from "./crawler-http";
import { currentSyncSignal, throwIfSyncCancelled } from "./sync-control";
import type { JobRecord } from "./job-types";

type StoredJob = { id: number; company: string; title: string; location: string; description: string; canonical_url: string;
  workplace_type: string | null; employment_type: string | null; department: string | null; posted_at: string;
  source_id: number; source_external_key: string; first_seen_at: string; publication_verified: number };
export async function reviewStoredJobs(db: D1Database, classifier: ReturnType<typeof createJobClassifier>, model: string,
  progress: (counts: { processed: number; accepted: number; rejected: number; errors: number; queued: number }) => Promise<void>,
  defer?: (job: JobRecord, sourceId: number, firstSeen: string) => Promise<void>) {
  let cursor = 0, processed = 0, accepted = 0, rejected = 0, errors = 0, queued = 0;
  const messages = new Set<string>();
  try {
  for (;;) {
    throwIfSyncCancelled();
    const rows = await db.prepare("SELECT * FROM jobs WHERE id>?1 AND (ai_policy IS NULL OR ai_policy<>?2) ORDER BY id LIMIT 100")
      .bind(cursor, AI_POLICY).all<StoredJob>();
    if (!rows.results.length) break;
    cursor = rows.results[rows.results.length-1].id;
    await mapPool(rows.results, async row => {
      const job: JobRecord = { externalId: row.source_external_key.includes(":") ? row.source_external_key.slice(row.source_external_key.indexOf(":")+1) : row.source_external_key,
        company: row.company, title: row.title, location: row.location, description: row.description, canonicalUrl: row.canonical_url,
        employmentType: row.employment_type, workplaceType: row.workplace_type, department: row.department,
        postedAt: row.publication_verified ? row.posted_at : null };
      try {
        const decision = await classifier.evaluate(job, { cacheOnly: true });
        throwIfSyncCancelled();
        if (decision.accepted) {
          await db.prepare("UPDATE jobs SET ai_policy=?2,ai_analysis=?3,ai_model=?4,ai_reviewed_at=?5 WHERE id=?1")
            .bind(row.id, AI_POLICY, JSON.stringify(decision), model, new Date().toISOString()).run();
          accepted++;
        } else { await db.prepare("DELETE FROM jobs WHERE id=?1").bind(row.id).run(); rejected++; }
      } catch (e) {
        if (e instanceof AwaitingClassification && defer) { await defer(job,row.source_id,row.first_seen_at); queued++; }
        else {
          throwIfSyncCancelled(); errors++;
          const message = e instanceof Error ? e.message : "筛选失败";
          messages.add(/SQLITE_BUSY|database is locked|D1_ERROR/.test(message) ? "本地数据库暂时繁忙，本条暂缓，下次重试" : message);
        }
        // Failed reviews remain hidden and will be retried. Never turn an API error into a rejection.
      } finally { processed++; }
      if (!currentSyncSignal()?.aborted) await progress({ processed, accepted, rejected, errors, queued });
    }, 4);
  }
  } catch (e) { if (!currentSyncSignal()?.aborted) throw e; }
  return { processed, accepted, rejected, errors, queued, messages: [...messages].slice(0, 3) };
}
