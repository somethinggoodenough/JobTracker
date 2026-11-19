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
import { crawlMetrics, requestLimiter, LOCAL_CRAWLER_CAPACITY } from "./crawl-performance";
import { crawlForSync, usesLocalCrawler, localCrawlerDiagnostics, localCrawlerHealth, LocalCrawlerDisconnected } from "./local-crawl-client";
import { DeadlineError, withDeadline } from "./deadline";
import { recoverStaleSync, SYNC_HEARTBEAT_INTERVAL_MS, SYNC_HEARTBEAT_SOURCE } from "./sync-lifecycle";
import { syncTuning } from "./sync-tuning";
import { isWorkdayHost, readWorkdayCooldown, saveWorkdayCooldown, WORKDAY_REQUEST_GAP_MS, WorkdayRateLimitError } from "./workday-rate-limit";

const DAY = 86_400_000;
type SyncOptions = { reviewOnly?: boolean; signal?: AbortSignal };

export async function runSync(options: SyncOptions = {}, crawl = crawlForSync): Promise<SyncSummary> {
  options.signal?.throwIfAborted();
  const db = getD1();
  const settings = await screeningSettings(db);
  return withScreeningRules(settings, () => runSyncWithSettings(options, crawl));
}
async function runSyncWithSettings(options: SyncOptions, crawl: typeof crawlForSync): Promise<SyncSummary> {
  const db = getD1();
  await recoverStaleSync(db);
  const tuning = syncTuning();
  const startedAt = Date.now();
  const now = new Date(startedAt).toISOString();
  const runDeadline = startedAt + tuning.runTimeoutMs;
  const cutoff = startedAt - 7 * DAY;
  const sources = await db.prepare("SELECT id, name, url, adapter FROM sources WHERE enabled = 1 ORDER BY id")
    .all<SourceRecord>();
  if (options.reviewOnly) sources.results = [];
  const pending = await db.prepare("SELECT COUNT(*) AS total FROM jobs WHERE ai_policy IS NULL OR ai_policy<>?1").bind(AI_POLICY).first<{ total: number }>();
  const reviewTotal = pending?.total ?? 0;
  options.signal?.throwIfAborted();
  const [run] = await db.batch([
    db.prepare(`INSERT INTO scrape_runs (status, started_at, sources_total, jobs_deleted)
      SELECT 'running', ?1, ?2, 0 WHERE NOT EXISTS (
        SELECT 1 FROM scrape_runs WHERE status IN ('running','cancelling') AND started_at > ?3
      )`).bind(now, sources.results.length + (reviewTotal ? 1 : 0) + 1,
      new Date(startedAt - Math.max(50 * 60_000, tuning.runTimeoutMs + 5 * 60_000)).toISOString()),
    db.prepare(`INSERT INTO scrape_source_progress(run_id,source_id,name,url,stage,updated_at)
      SELECT last_insert_rowid(),?1,'同步进程心跳','/','success',?2 WHERE changes()=1`)
      .bind(SYNC_HEARTBEAT_SOURCE, now),
  ]);
  if (!run.meta.changes) throw new Error("另一次同步仍在进行，请稍后再试");
  const runId = Number(run.meta.last_row_id);
  let nextHeartbeat = startedAt;
  const control = createSyncControl(async () => {
    const row = await db.prepare("SELECT status FROM scrape_runs WHERE id=?1").bind(runId).first<{ status: string }>();
    if (row?.status !== "running") return true;
    if (Date.now() >= nextHeartbeat) {
      await db.prepare(`UPDATE scrape_source_progress SET updated_at=?3 WHERE run_id=?1 AND source_id=?2
        AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND status='running')`)
        .bind(runId, SYNC_HEARTBEAT_SOURCE, new Date().toISOString()).run();
      nextHeartbeat = Date.now() + SYNC_HEARTBEAT_INTERVAL_MS;
    }
    return false;
  });
  const config = deepseekConfig(), classifier = createJobClassifier(db, config);
  const localBoards = sources.results.filter(usesLocalCrawler).length;
  const errors: string[] = [];
  const sourceErrors = new Map<number, string>();
  let purged = 0, succeeded = 0, seen = 0, added = 0, updated = 0, localHeapPeakMb = 0;
  let audited = 0, queueAdded = 0, queueUpdated = 0, queueRejected = 0, deferred = false;
  let queueStarted = "", lastQueueUpdate = 0;
  const queueErrors = new Set<string>();

  async function processRun(signal: AbortSignal) {
    throwIfSyncCancelled();
    await seedDiscoveries(db);
    throwIfSyncCancelled();
    const [, deleted] = await db.batch([
      db.prepare("UPDATE jobs SET posted_at=first_seen_at WHERE publication_verified=0 AND posted_at<>first_seen_at"),
      db.prepare("DELETE FROM jobs WHERE posted_at <= ?").bind(new Date(cutoff).toISOString()),
      db.prepare("DELETE FROM job_candidates WHERE expires_at<=?").bind(now),
      db.prepare("UPDATE job_candidates SET claim_run_id=NULL WHERE claim_run_id IS NOT NULL"),
      db.prepare("DELETE FROM crawl_details WHERE expires_at<=?").bind(Date.now()),
    ]);
    throwIfSyncCancelled();
    purged = deleted.meta.changes ?? 0;
    if (sources.results.length) {
      await db.batch(sources.results.map((source) => db.prepare(`INSERT INTO scrape_source_progress
        (run_id, source_id, name, url, updated_at) VALUES (?1,?2,?3,?4,?5)`)
        .bind(runId, source.id, source.name, source.url, now)));
    }
    throwIfSyncCancelled();
    const mixed = localBoards > 0 && localBoards < sources.results.length;
    const workerRequests = !localBoards ? 0 : mixed ? Math.max(0, tuning.requests - 2) : tuning.requests;
    const limit = requestLimiter(Math.max(1, tuning.requests - (mixed ? workerRequests : 0)));
    let writes = Promise.resolve();
    function write<T>(fn: () => Promise<T>) {
      const task = writes.then(() => { throwIfSyncCancelled(); return fn(); });
      writes = task.then(() => {}, () => {});
      return task;
    }
    await db.prepare(`INSERT INTO scrape_source_progress(run_id,source_id,name,url,updated_at)
      VALUES(?1,-1,'候选队列与每日模型额度','/',?2)`).bind(runId,now).run();
    throwIfSyncCancelled();
    await db.prepare("DELETE FROM job_evaluations WHERE expires_at<=?1").bind(now).run();
    throwIfSyncCancelled();
    if (reviewTotal) {
      await db.prepare(`INSERT INTO scrape_source_progress (run_id,source_id,name,url,stage,started_at,updated_at,jobs_total)
        VALUES (?1,0,'已有职位 AI 筛选','/','classifying',?2,?2,?3)`).bind(runId, now, reviewTotal).run();
      let lastReviewProgress = 0;
      const review = await reviewStoredJobs(db, classifier, config.model, async counts => {
        throwIfSyncCancelled();
        if (Date.now()-lastReviewProgress < 800) return;
        lastReviewProgress = Date.now();
        await db.prepare(`UPDATE scrape_source_progress SET jobs_processed=?2,jobs_updated=?3,jobs_ignored=?4,updated_at=?5,jobs_queued=?6
          WHERE run_id=?1 AND source_id=0 AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND status='running')`)
          .bind(runId, counts.processed, counts.accepted, counts.rejected, new Date().toISOString(), counts.queued).run();
      }, async (job,sourceId,firstSeen) => {
        const source = await db.prepare("SELECT id,name,url,adapter FROM sources WHERE id=?1").bind(sourceId).first<SourceRecord>();
        if (source) await upsertJob(db,source,job,now,cutoff,classifier,config.model,undefined,firstSeen,true);
      });
      throwIfSyncCancelled();
      purged += review.rejected; updated += review.accepted; seen += review.processed;
      if (review.errors) errors.push(`已有职位 AI 筛选：${review.errors} 条暂缓，${review.messages.join('；')}`);
      await db.prepare(`UPDATE scrape_source_progress SET stage=?2,jobs_processed=?3,jobs_updated=?4,jobs_ignored=?5,
        error=?6,finished_at=?7,updated_at=?7,jobs_queued=?8 WHERE run_id=?1 AND source_id=0
        AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND status='running')`)
        .bind(runId, control.signal.aborted ? "cancelled" : review.errors ? "partial" : "success", review.processed, review.accepted, review.rejected,
          review.errors ? `${review.errors} 条筛选失败，暂不显示，下次重试：${review.messages.join('；')}` : null, new Date().toISOString(), review.queued).run();
      succeeded++;
    }

    const sourceQueue = sources.results.map(source => ({ source, retryAt: 0,
      workday: URL.canParse(source.url) && isWorkdayHost(new URL(source.url).hostname) }));
    let workdayCooldown = sourceQueue.some(item => item.workday) ? await readWorkdayCooldown(db) : null;
    if (workdayCooldown) errors.push(`Workday 限流冷却中 · ${workdayCooldown.address}`);

    async function syncSource(source: SourceRecord, retry: boolean, workday: boolean) {
      const metrics = crawlMetrics();
      const crawlId = `${runId}:${source.id}`;
      let crawlStarted = 0;
      let processed = 0, sourceAdded = 0, sourceUpdated = 0, ignored = 0, total = 0, queued = 0;
      let lastSaved = 0;
      const saveProgress = async (stage: string, error: string | null = null) => {
        throwIfSyncCancelled();
        const stamp = new Date().toISOString();
        const saved = await db.prepare(`UPDATE scrape_source_progress SET stage=?1, updated_at=?2,
          jobs_total=?3, jobs_processed=?4, jobs_added=?5, jobs_updated=?6, jobs_ignored=?7,
          error=?8, finished_at=?9,jobs_queued=?12,metrics_json=?13 WHERE run_id=?10 AND source_id=?11
          AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?10 AND status='running')`)
          .bind(stage, stamp, total, processed, sourceAdded, sourceUpdated, ignored, error,
            ["success", "failed", "partial", "cancelled", "rate_limited"].includes(stage) ? stamp : null, runId, source.id, queued, JSON.stringify(metrics)).run();
        lastSaved = Date.now();
        return !!saved.meta.changes;
      };
      try {
        throwIfSyncCancelled();
        if (workday && workdayCooldown) {
          metrics.workdayCooldown = workdayCooldown;
          await saveProgress("rate_limited");
          return false;
        }
        const entry = await db.prepare(`UPDATE scrape_source_progress SET stage='fetching', started_at=?1, updated_at=?1,
          finished_at=NULL, error=NULL, metrics_json=NULL WHERE run_id=?2 AND source_id=?3
          AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?2 AND status='running')`)
          .bind(new Date().toISOString(), runId, source.id).run();
        if (!entry.meta.changes) return false;
        throwIfSyncCancelled();
        crawlStarted = Date.now();
        const sourceTimeoutMs = tuning.sourceTimeoutMs;
        const jobs = await withDeadline("单个来源抓取", sourceTimeoutMs, signal, sourceSignal =>
          withSyncSignal(sourceSignal, () => crawl(db, source, { metrics, limit }, {
            concurrency: workerRequests, crawlId, deadlineMs: crawlStarted + sourceTimeoutMs, sourceTimeoutMs,
          }))).finally(() => { metrics.crawlMs = Date.now() - crawlStarted; });
        throwIfSyncCancelled();
        total = jobs.length;
        if (!await saveProgress("saving")) return false;
        for (let offset = 0; offset < jobs.length; offset += 12) {
          throwIfSyncCancelled();
          const rows = jobs.slice(offset, offset + 12);
          const valid = rows.filter(job => job.title && job.canonicalUrl);
          const results = await write(async () => {
            const started = Date.now();
            try { return await upsertJobs(db, source, valid, now, cutoff, classifier, config.model); }
            finally { metrics.dbMs += Date.now() - started; }
          });
          throwIfSyncCancelled();
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
          if (Date.now() - lastSaved >= 1000 && !await saveProgress("saving")) return false;
        }
        throwIfSyncCancelled();
        const warning = jobs.warnings?.join("\n") || null;
        const incomplete = jobs.warnings?.filter(message => !/发布日期未知|未提供发布日期，本轮仅取/.test(message)).join("\n") || null;
        if (incomplete) sourceErrors.set(source.id, `${source.name}: ${incomplete}`);
        else sourceErrors.delete(source.id);
        await db.prepare(`UPDATE sources SET last_success_at=?1,last_error=?3,updated_at=?1 WHERE id=?2
          AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?4 AND status='running')`).bind(now, source.id, incomplete, runId).run();
        await saveProgress(incomplete ? "partial" : "success", warning);
        throwIfSyncCancelled();
        succeeded++;
        return false;
      } catch (error) {
        if (signal.aborted) return false;
        if (error instanceof WorkdayRateLimitError) {
          if (!workdayCooldown) errors.push(`Workday · ${error.message}`);
          workdayCooldown = error.cooldown;
          metrics.workdayCooldown = error.cooldown;
          await saveWorkdayCooldown(db, error.cooldown);
          await saveProgress("rate_limited", error.message);
          return false;
        }
        let message = error instanceof Error ? error.message : String(error);
        if (error instanceof DeadlineError && error.label === "单个来源抓取") {
          metrics.deadlineHit = true;
          if (workerRequests > 0 && usesLocalCrawler(source)) {
            const { status, health } = await localCrawlerDiagnostics(crawlId, runId, signal);
            if (signal.aborted) return false;
            if (status?.lastRequest) metrics.lastRequest = status.lastRequest;
            metrics.activeRequests = status?.activeRequests ?? metrics.activeRequests;
            metrics.maxResponseBytes = Math.max(metrics.maxResponseBytes, status?.maxResponseBytes ?? 0);
            metrics.localHealth = health;
            metrics.localHeapPeakMb = Math.max(metrics.localHeapPeakMb, health?.heapPeakMb ?? 0);
          }
          const last = metrics.lastRequest;
          const address = new URL(source.url);
          message = `${error.message}，下轮重试；` + (last
            ? `最后请求：${last.address}，开始于 ${last.startedAt}`
            : `最后请求未获取，来源入口：${address.host}${address.pathname}，开始于 ${new Date(crawlStarted).toISOString()}`);
        }
        const retryAvailable = error instanceof LocalCrawlerDisconnected && !retry
          && runDeadline - Date.now() >= tuning.sourceTimeoutMs;
        if (retryAvailable) message += "，已安排在本轮队尾补跑一次";
        sourceErrors.set(source.id, `${source.name}: ${message}`);
        throwIfSyncCancelled();
        await db.prepare(`UPDATE sources SET last_error=?1,updated_at=?2 WHERE id=?3
          AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?4 AND status='running')`).bind(message.slice(0, 500), now, source.id, runId).run();
        await saveProgress("failed", message.slice(0, 1000));
        return retryAvailable;
      } finally {
        localHeapPeakMb = Math.max(localHeapPeakMb, metrics.localHeapPeakMb);
      }
    }

    const sourceSlots = Math.min(tuning.sources, workerRequests > 0 ? LOCAL_CRAWLER_CAPACITY : tuning.sources, sourceQueue.length);
    let workdayActive = false;
    let nextWorkdaySource = 0;
    let crawlDone = false;
    const crawling = Promise.allSettled(Array.from({ length: sourceSlots }, async () => {
      while (sourceQueue.length && !signal.aborted) {
        const index = sourceQueue.findIndex(item => !item.workday || !workdayActive);
        if (index < 0) return;
        const [item] = sourceQueue.splice(index, 1);
        const { source, retryAt, workday } = item;
        if (workday) workdayActive = true;
        try {
          if (retryAt && (!workday || !workdayCooldown)) {
            if (retryAt > Date.now()) await syncDelay(retryAt - Date.now());
            if (runDeadline - Date.now() < tuning.sourceTimeoutMs) continue;
          }
          if (workday && !workdayCooldown && nextWorkdaySource > Date.now()) await syncDelay(nextWorkdaySource - Date.now());
          if (await syncSource(source, retryAt > 0, workday) && !signal.aborted) {
            sourceQueue.push({ ...item, retryAt: Date.now() + 2500 });
          }
        } finally {
          if (workday) {
            nextWorkdaySource = Date.now() + WORKDAY_REQUEST_GAP_MS;
            workdayActive = false;
          }
        }
      }
    })).then(results => {
      if (signal.aborted) return;
      crawlDone = true;
      for (const result of results) if (result.status === "rejected") errors.push(String(result.reason));
    });

    // Consumers claim candidates atomically. Only the current content may be committed.
    async function saveQueueProgress() {
      throwIfSyncCancelled();
      const stamp = new Date().toISOString();
      await db.prepare(`UPDATE scrape_source_progress SET stage='classifying',started_at=?2,updated_at=?3,
        jobs_total=MAX(jobs_total,?4+(SELECT COUNT(*) FROM job_candidates)),jobs_processed=?4,jobs_added=?5,
        jobs_updated=?6,jobs_ignored=?7 WHERE run_id=?1 AND source_id=-1
        AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND status='running')`)
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
          throwIfSyncCancelled();
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
            throwIfSyncCancelled();
            if (!current || current.content_hash !== next.content_hash || current.payload_json !== next.payload_json) return;
            if (decision === null) queueRejected++;
            else {
              const result = await upsertJob(db, current, job, new Date().toISOString(), Date.now() - 7 * DAY,
                classifier, config.model, decision, next.first_seen_at, true);
              throwIfSyncCancelled();
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
          if (!signal.aborted) audited++;
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
    const reviewed = await consumers;
    throwIfSyncCancelled();
    for (const result of reviewed) if (result.status === "rejected") queueErrors.add(String(result.reason));
    if (localBoards) {
      const health = await localCrawlerHealth(runId, signal);
      throwIfSyncCancelled();
      localHeapPeakMb = Math.max(localHeapPeakMb, health?.heapPeakMb ?? 0);
    }
    succeeded++;
  }

  let interrupted = false;
  let failed = false;
  const parent = options.signal ? AbortSignal.any([options.signal, control.signal]) : control.signal;
  try {
    await withDeadline("整轮同步", Math.max(1, runDeadline - Date.now()), parent, signal =>
      withCrawlWindow(dayWindow(new Date(now)), () => withSyncSignal(signal, () => processRun(signal))));
  } catch (error) {
    interrupted = true;
    if (!control.signal.aborted) {
      if (error instanceof DeadlineError && error.label === "整轮同步") {
        errors.push(`同步达到 ${tuning.runTimeoutMs / 1000} 秒时限，剩余候选已保留`);
      } else {
        failed = !options.signal?.aborted;
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    control.close();
  }
  errors.push(...sourceErrors.values());
  for (const error of queueErrors) errors.push(`候选审核：${error}`);
  const queueCount = (await db.prepare("SELECT COUNT(*) AS total FROM job_candidates").first<{ total: number }>())?.total ?? 0;
  const queueEnd = new Date().toISOString();
  const queueMetrics = { ...crawlMetrics(), aiMs: classifier.metrics.requestMs, localHeapPeakMb };
  const status = control.signal.aborted ? "cancelled" : failed ? "failed" : errors.length === 0 ? "success" : succeeded > 0 ? "partial" : "failed";
  const [ended] = await db.batch<{ status: SyncSummary["status"] }>([
    db.prepare(`UPDATE scrape_runs SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE ?1 END, finished_at=?2, sources_succeeded=?3,
      jobs_seen=?4, jobs_added=?5, jobs_updated=?6, error_summary=?7, jobs_deleted=?8,
      jobs_queued=?10,ai_rule_rejected=?11,ai_cache_hits=?12,ai_requests=?13
      WHERE id=?9 AND status IN ('running','cancelling') RETURNING status`)
      .bind(status, queueEnd, succeeded, seen, added, updated, errors.join("\n").slice(0, 4000) || null, purged, runId,
        queueCount, classifier.metrics.ruleRejected, classifier.metrics.cacheHits, classifier.metrics.requests),
    db.prepare(`UPDATE scrape_source_progress SET
      stage=CASE WHEN (SELECT status FROM scrape_runs WHERE id=?1)='cancelled' THEN 'cancelled' ELSE ?2 END,
      jobs_queued=?3,finished_at=?4,updated_at=?4,error=?5,started_at=COALESCE(started_at,?4),
      jobs_processed=?6,jobs_added=?7,jobs_updated=?8,jobs_ignored=?9,jobs_total=MAX(jobs_total,?6+?3),metrics_json=?10
      WHERE run_id=?1 AND source_id=-1 AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND finished_at=?4)`)
      .bind(runId, interrupted ? "failed" : queueErrors.size ? "partial" : deferred && queueCount ? "deferred" : "success",
        queueCount, queueEnd, [...queueErrors].slice(0, 3).join("；").slice(0, 1000) || null,
        audited, queueAdded, queueUpdated, queueRejected, JSON.stringify(queueMetrics)),
    db.prepare(`UPDATE scrape_source_progress SET
      stage=CASE WHEN (SELECT status FROM scrape_runs WHERE id=?1)='cancelled' THEN 'cancelled' ELSE 'failed' END,
      finished_at=?2, updated_at=?2, error=COALESCE(error,?3)
      WHERE run_id=?1 AND stage IN ('queued','fetching','saving','classifying')
      AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND finished_at=?2)`)
      .bind(runId, queueEnd, errors[0] ?? null),
    db.prepare(`UPDATE job_candidates SET claim_run_id=NULL WHERE claim_run_id=?1
      AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND finished_at=?2)`).bind(runId, queueEnd),
  ]);
  const finished = ended.results[0];
  if (!finished) {
    const terminal = await db.prepare("SELECT * FROM scrape_runs WHERE id=?1").bind(runId).first<{
      status: SyncSummary["status"]; sources_total: number; sources_succeeded: number; jobs_seen: number;
      jobs_added: number; jobs_updated: number; jobs_deleted: number; jobs_queued: number; error_summary: string | null;
    }>();
    if (!terminal) throw Error("同步记录不存在");
    return { runId, status: terminal.status, sourcesTotal: terminal.sources_total, sourcesSucceeded: terminal.sources_succeeded,
      jobsSeen: terminal.jobs_seen, jobsAdded: terminal.jobs_added, jobsUpdated: terminal.jobs_updated,
      jobsDeleted: terminal.jobs_deleted, jobsQueued: terminal.jobs_queued, errors: terminal.error_summary ? [terminal.error_summary] : [] };
  }
  const finalStatus = finished.status;
  return { runId, status: finalStatus, sourcesTotal: sources.results.length + (reviewTotal ? 1 : 0) + 1, sourcesSucceeded: succeeded,
    jobsSeen: seen, jobsAdded: added, jobsUpdated: updated,
    jobsDeleted: purged, jobsQueued: queueCount, errors };
}
