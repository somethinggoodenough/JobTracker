import { getD1 } from "./database";
import type { JobRecord, SourceRecord, SyncSummary } from "./job-types";
import { createSyncControl, syncDelay, throwIfSyncCancelled, withSyncSignal } from "./sync-control";
import { dayWindow, withCrawlWindow } from "./crawl-window";
import { AI_POLICY } from "./classification-types";
import { createJobClassifier } from "./job-classifier";
import { deepseekConfig } from "./deepseek-config";
import { reviewStoredJobs } from "./job-review";
import { seedDiscoveries, upsertJob, upsertJobs } from "./job-storage";
import { DailyModelLimit } from "./ai-budget";
import { claimCandidate, reviewCurrentCandidate, type ClaimedCandidate } from "./job-candidates";
import { screeningSettings } from "./screening-settings";
import { withScreeningRules } from "./screening-context";
import { crawlMetrics, requestLimiter } from "./crawl-performance";
import { crawlForSync, usesLocalCrawler } from "./local-crawl-client";
import { syncTuning } from "./sync-tuning";

const DAY = 86_400_000;

export async function runSync(options: { reviewOnly?: boolean } = {}): Promise<SyncSummary> {
  const db = getD1();
  const settings = await screeningSettings(db);
  return withScreeningRules(settings, () => runSyncWithSettings(options));
}
async function runSyncWithSettings(options: { reviewOnly?: boolean }): Promise<SyncSummary> {
  const db = getD1();
  const now = new Date().toISOString();
  const cutoff = Date.now() - 7 * DAY;
  const sources = await db.prepare("SELECT id, name, url, adapter FROM sources WHERE enabled = 1 ORDER BY id")
    .all<SourceRecord>();
  if (options.reviewOnly) sources.results = [];
  const pending = await db.prepare("SELECT COUNT(*) AS total FROM jobs WHERE ai_policy IS NULL OR ai_policy<>?1").bind(AI_POLICY).first<{ total: number }>();
  const reviewTotal = pending?.total ?? 0;
  const run = await db.prepare(`INSERT INTO scrape_runs (status, started_at, sources_total, jobs_deleted)
    SELECT 'running', ?1, ?2, 0 WHERE NOT EXISTS (
      SELECT 1 FROM scrape_runs WHERE status IN ('running','cancelling') AND started_at > ?3
    )`).bind(now, sources.results.length + (reviewTotal ? 1 : 0) + 1,
      new Date(Date.now() - 50 * 60_000).toISOString()).run();
  if (!run.meta.changes) throw new Error("另一次同步仍在进行，请稍后再试");
  const runId = Number(run.meta.last_row_id);
  const control = createSyncControl(async () => {
    const row = await db.prepare("SELECT status FROM scrape_runs WHERE id=?1").bind(runId).first<{ status: string }>();
    return row?.status === "cancelling";
  });
  const signal = AbortSignal.any([control.signal, AbortSignal.timeout(45 * 60_000)]);
  return withCrawlWindow(dayWindow(new Date(now)), () => withSyncSignal(signal, async () => {
  try {
  await seedDiscoveries(db);
  const [, deleted] = await db.batch([
    db.prepare("UPDATE jobs SET posted_at=first_seen_at WHERE publication_verified=0 AND posted_at<>first_seen_at"),
    db.prepare("DELETE FROM jobs WHERE posted_at <= ?").bind(new Date(cutoff).toISOString()),
    db.prepare("DELETE FROM job_candidates WHERE expires_at<=?").bind(now),
    db.prepare("UPDATE job_candidates SET claim_run_id=NULL WHERE claim_run_id IS NOT NULL"),
    db.prepare("DELETE FROM crawl_details WHERE expires_at<=?").bind(Date.now()),
  ]);
  let purged = deleted.meta.changes ?? 0;
  if (sources.results.length) {
    await db.batch(sources.results.map((source) => db.prepare(`INSERT INTO scrape_source_progress
      (run_id, source_id, name, url, updated_at) VALUES (?1,?2,?3,?4,?5)`)
      .bind(runId, source.id, source.name, source.url, now)));
  }
  let succeeded = 0, seen = 0, added = 0, updated = 0;
  const errors: string[] = [];
  const config = deepseekConfig(), classifier = createJobClassifier(db, config);
  const tuning = syncTuning();
  const localBoards = sources.results.filter(usesLocalCrawler).length;
  const mixed = localBoards > 0 && localBoards < sources.results.length;
  const workerRequests = !localBoards ? 0 : mixed ? Math.max(0, tuning.requests - 2) : tuning.requests;
  const limit = requestLimiter(Math.max(1, tuning.requests - (mixed ? workerRequests : 0)));
  let writes = Promise.resolve();
  function write<T>(fn: () => Promise<T>) {
    const task = writes.then(fn);
    writes = task.then(() => {}, () => {});
    return task;
  }
  await db.prepare(`INSERT INTO scrape_source_progress(run_id,source_id,name,url,updated_at)
    VALUES(?1,-1,'候选队列与每日模型额度','/',?2)`).bind(runId,now).run();
  await db.prepare("DELETE FROM job_evaluations WHERE expires_at<=?1").bind(now).run();
  if (reviewTotal) {
    await db.prepare(`INSERT INTO scrape_source_progress (run_id,source_id,name,url,stage,started_at,updated_at,jobs_total)
      VALUES (?1,0,'已有职位 AI 筛选','/','classifying',?2,?2,?3)`).bind(runId, now, reviewTotal).run();
    let lastReviewProgress = 0;
    const review = await reviewStoredJobs(db, classifier, config.model, async counts => {
      if (Date.now()-lastReviewProgress < 800) return;
      lastReviewProgress = Date.now();
      await db.prepare(`UPDATE scrape_source_progress SET jobs_processed=?2,jobs_updated=?3,jobs_ignored=?4,updated_at=?5,jobs_queued=?6
        WHERE run_id=?1 AND source_id=0`).bind(runId, counts.processed, counts.accepted, counts.rejected, new Date().toISOString(),counts.queued).run();
    }, async (job,sourceId,firstSeen) => {
      const source = await db.prepare("SELECT id,name,url,adapter FROM sources WHERE id=?1").bind(sourceId).first<SourceRecord>();
      if (source) await upsertJob(db,source,job,now,cutoff,classifier,config.model,undefined,firstSeen,true);
    });
    purged += review.rejected; updated += review.accepted; seen += review.processed;
    if (review.errors) errors.push(`已有职位 AI 筛选：${review.errors} 条暂缓，${review.messages.join('；')}`);
    await db.prepare(`UPDATE scrape_source_progress SET stage=?2,jobs_processed=?3,jobs_updated=?4,jobs_ignored=?5,
      error=?6,finished_at=?7,updated_at=?7,jobs_queued=?8 WHERE run_id=?1 AND source_id=0`)
      .bind(runId, control.signal.aborted ? "cancelled" : review.errors ? "partial" : "success", review.processed, review.accepted, review.rejected,
        review.errors ? `${review.errors} 条筛选失败，暂不显示，下次重试：${review.messages.join('；')}` : null, new Date().toISOString(), review.queued).run();
    if (!control.signal.aborted) succeeded++;
  }

  const syncSource = async (source: SourceRecord) => {
    const metrics = crawlMetrics();
    let sourceTimeout: AbortSignal | undefined;
    let processed = 0, sourceAdded = 0, sourceUpdated = 0, ignored = 0, total = 0, queued = 0;
    let lastSaved = 0;
    const saveProgress = async (stage: string, error: string | null = null) => {
      const stamp = new Date().toISOString();
      await db.prepare(`UPDATE scrape_source_progress SET stage=?1, updated_at=?2,
        jobs_total=?3, jobs_processed=?4, jobs_added=?5, jobs_updated=?6, jobs_ignored=?7,
        error=?8, finished_at=?9,jobs_queued=?12,metrics_json=?13 WHERE run_id=?10 AND source_id=?11`)
        .bind(stage, stamp, total, processed, sourceAdded, sourceUpdated, ignored, error,
          ["success", "failed", "partial", "cancelled"].includes(stage) ? stamp : null, runId, source.id, queued, JSON.stringify(metrics)).run();
      lastSaved = Date.now();
    };
    try {
      throwIfSyncCancelled();
      await db.prepare(`UPDATE scrape_source_progress SET stage='fetching', started_at=?1,
        updated_at=?1 WHERE run_id=?2 AND source_id=?3`)
        .bind(new Date().toISOString(), runId, source.id).run();
      const crawlStarted = Date.now();
      sourceTimeout = AbortSignal.timeout(tuning.sourceTimeoutMs);
      const sourceSignal = AbortSignal.any([signal, sourceTimeout]);
      const jobs = await withSyncSignal(sourceSignal, () => crawlForSync(db, source, { metrics, limit }, workerRequests))
        .finally(() => { metrics.crawlMs = Date.now() - crawlStarted; });
      sourceSignal.throwIfAborted();
      throwIfSyncCancelled();
      total = jobs.length;
      await saveProgress("saving");
      for (let offset = 0; offset < jobs.length; offset += 12) {
        throwIfSyncCancelled();
        const rows = jobs.slice(offset, offset + 12);
        const valid = rows.filter(job => job.title && job.canonicalUrl);
        const results = await write(async () => {
          const started = Date.now();
          try { return await upsertJobs(db, source, valid, now, cutoff, classifier, config.model); }
          finally { metrics.dbMs += Date.now() - started; }
        });
        seen += valid.length;
        processed += rows.length;
        ignored += rows.length - valid.length;
        for (const result of results) {
          purged += result.deleted;
          if (result.state === "added") { added++; sourceAdded++; }
          if (result.state === "updated") { updated++; sourceUpdated++; }
          if (result.state === "ignored" || result.state === "unchanged") ignored++;
          if (result.state === "queued") queued++;
        }
        if (Date.now() - lastSaved >= 1000) await saveProgress("saving");
      }
      succeeded += 1;
      const warning = jobs.warnings?.join("\n") || null;
      const incomplete = jobs.warnings?.filter(message => !/发布日期未知|未提供发布日期，本轮仅取/.test(message)).join("\n") || null;
      if (incomplete) errors.push(`${source.name}: ${incomplete}`);
      await db.prepare("UPDATE sources SET last_success_at=?1, last_error=?3, updated_at=?1 WHERE id=?2")
        .bind(now, source.id, incomplete).run();
      await saveProgress(incomplete ? "partial" : "success", warning);
    } catch (error) {
      if (signal.aborted) { await saveProgress("cancelled"); return; }
      const message = sourceTimeout?.aborted
        ? `单个来源抓取超过 ${tuning.sourceTimeoutMs / 1000} 秒，下轮重试`
        : error instanceof Error ? error.message : String(error);
      errors.push(`${source.name}: ${message}`);
      await db.prepare("UPDATE sources SET last_error=?1, updated_at=?2 WHERE id=?3")
        .bind(message.slice(0, 500), now, source.id).run();
      await saveProgress("failed", message.slice(0, 1000));
    }
  };

  let cursor = 0;
  let crawlDone = false;
  const crawling = Promise.allSettled(Array.from({ length: Math.min(tuning.sources, sources.results.length) }, async () => {
    while (cursor < sources.results.length && !signal.aborted) await syncSource(sources.results[cursor++]);
  })).then(results => {
    crawlDone = true;
    for (const result of results) if (result.status === "rejected") errors.push(String(result.reason));
  });

  // Consumers claim candidates atomically. Only the current content may be committed.
  let audited = 0, queueAdded = 0, queueUpdated = 0, queueRejected = 0, deferred = false;
  let queueStarted = "", lastQueueUpdate = 0;
  const queueErrors = new Set<string>();
  async function saveQueueProgress() {
    const stamp = new Date().toISOString();
    await db.prepare(`UPDATE scrape_source_progress SET stage='classifying',started_at=?2,updated_at=?3,
      jobs_total=MAX(jobs_total,?4+(SELECT COUNT(*) FROM job_candidates)),jobs_processed=?4,jobs_added=?5,
      jobs_updated=?6,jobs_ignored=?7 WHERE run_id=?1 AND source_id=-1`)
      .bind(runId, queueStarted, stamp, audited, queueAdded, queueUpdated, queueRejected).run();
  }
  async function consumeCandidates() {
    while (!signal.aborted && !deferred) {
      const next = await claimCandidate(db, runId);
      if (!next) {
        if (crawlDone) return;
        try { await syncDelay(500); } catch (error) { if (!signal.aborted) throw error; }
        continue;
      }
      try {
        if (!queueStarted) {
          queueStarted = new Date().toISOString();
          await saveQueueProgress();
        }
        const job = JSON.parse(next.payload_json) as JobRecord;
        const decision = await reviewCurrentCandidate(classifier, job);
        await write(async () => {
          throwIfSyncCancelled();
          const current = await db.prepare(`SELECT c.content_hash,c.payload_json,s.id,s.name,s.url,s.adapter
            FROM job_candidates c JOIN sources s ON s.id=c.source_id WHERE c.id=? AND c.claim_run_id=?`)
            .bind(next.id, runId).first<SourceRecord & Pick<ClaimedCandidate, "content_hash" | "payload_json">>();
          if (!current || current.content_hash !== next.content_hash || current.payload_json !== next.payload_json) return;
          if (decision === null) queueRejected++;
          else {
            const result = await upsertJob(db, current, job, new Date().toISOString(), Date.now() - 7 * DAY,
              classifier, config.model, decision, next.first_seen_at, true);
            if (result.state === "added") { added++; queueAdded++; }
            if (result.state === "updated") { updated++; queueUpdated++; }
            if (result.state === "ignored") queueRejected++;
            purged += result.deleted;
          }
          await db.prepare("DELETE FROM job_candidates WHERE id=? AND claim_run_id=?").bind(next.id, runId).run();
          audited++;
        });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof DailyModelLimit) { deferred = true; return; }
        const message = error instanceof Error ? error.message : "模型审核暂时失败";
        queueErrors.add(message);
        await db.prepare(`UPDATE job_candidates SET last_error=?2,next_retry_at=?3
          WHERE id=?1 AND claim_run_id=?4 AND content_hash=?5 AND payload_json=?6`)
          .bind(next.id, message.slice(0, 300), new Date(Date.now() + 3600000).toISOString(), runId, next.content_hash, next.payload_json).run();
        audited++;
      } finally {
        await db.prepare("UPDATE job_candidates SET claim_run_id=NULL WHERE id=? AND claim_run_id=?").bind(next.id, runId).run();
      }
      if (Date.now() - lastQueueUpdate >= 1000) {
        lastQueueUpdate = Date.now();
        await saveQueueProgress();
      }
    }
  }
  const consumers = Promise.allSettled(Array.from({ length: tuning.ai }, consumeCandidates));
  await crawling;
  for (const result of await consumers) if (result.status === "rejected") queueErrors.add(String(result.reason));
  for (const error of queueErrors) errors.push(`候选审核：${error}`);
  const queueCount = (await db.prepare("SELECT COUNT(*) AS total FROM job_candidates").first<{ total: number }>())?.total ?? 0;
  const queueEnd = new Date().toISOString();
  const queueMetrics = { ...crawlMetrics(), aiMs: classifier.metrics.requestMs };
  await db.prepare(`UPDATE scrape_source_progress SET stage=?2,jobs_queued=?3,finished_at=?4,updated_at=?4,error=?5,
    started_at=COALESCE(started_at,?4),jobs_processed=?6,jobs_added=?7,jobs_updated=?8,jobs_ignored=?9,
    jobs_total=MAX(jobs_total,?6+?3),metrics_json=?10 WHERE run_id=?1 AND source_id=-1`)
    .bind(runId, signal.aborted ? "cancelled" : queueErrors.size ? "partial" : deferred && queueCount ? "deferred" : "success",
      queueCount, queueEnd, [...queueErrors].slice(0, 3).join("；").slice(0, 1000) || null,
      audited, queueAdded, queueUpdated, queueRejected, JSON.stringify(queueMetrics)).run();
  if (!signal.aborted) succeeded++;
  if (signal.aborted && !control.signal.aborted) errors.push("同步达到 45 分钟时限，剩余候选已保留");

  const status = control.signal.aborted ? "cancelled" : errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "failed";
  const finished = await db.prepare(`UPDATE scrape_runs SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE ?1 END, finished_at=?2, sources_succeeded=?3,
    jobs_seen=?4, jobs_added=?5, jobs_updated=?6, error_summary=?7, jobs_deleted=?8 WHERE id=?9 RETURNING status`)
    .bind(status, new Date().toISOString(), succeeded, seen, added, updated,
      errors.join("\n").slice(0, 4000) || null, purged, runId).first<{ status: SyncSummary["status"] }>();
  const finalStatus = finished?.status ?? status;
  await db.prepare("UPDATE scrape_runs SET jobs_queued=?2,ai_rule_rejected=?3,ai_cache_hits=?4,ai_requests=?5 WHERE id=?1")
    .bind(runId,queueCount,classifier.metrics.ruleRejected,classifier.metrics.cacheHits,classifier.metrics.requests).run();
  if (signal.aborted || finalStatus === "cancelled") {
    await db.prepare(`UPDATE scrape_source_progress SET stage='cancelled', finished_at=?1, updated_at=?1
      WHERE run_id=?2 AND stage IN ('queued','fetching','saving','classifying')`).bind(new Date().toISOString(), runId).run();
  }
  return { runId, status: finalStatus, sourcesTotal: sources.results.length + (reviewTotal ? 1 : 0) + 1, sourcesSucceeded: succeeded,
    jobsSeen: seen, jobsAdded: added, jobsUpdated: updated,
    jobsDeleted: purged, jobsQueued: queueCount, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.batch([
      db.prepare("UPDATE scrape_runs SET status='failed',finished_at=?,error_summary=? WHERE id=?").bind(new Date().toISOString(), message.slice(0, 4000), runId),
      db.prepare("UPDATE job_candidates SET claim_run_id=NULL WHERE claim_run_id=?").bind(runId),
    ]).catch(() => {});
    throw error;
  } finally { control.close(); }
  }));
}
