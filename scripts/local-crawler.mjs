import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { pathToFileURL } from 'node:url';
import { loadLocalTypeScript } from './load-local-typescript.mjs';

const { executeCrawl, isBuiltInBoard } = loadLocalTypeScript('lib/crawl-execution.ts');
const { requestLimiter, crawlMetrics, LOCAL_CRAWLER_CAPACITY } = loadLocalTypeScript('lib/crawl-performance.ts');
const { DeadlineError, withDeadline } = loadLocalTypeScript('lib/deadline.ts');
const { withSyncSignal } = loadLocalTypeScript('lib/sync-control.ts');
const { withCrawlWindow } = loadLocalTypeScript('lib/crawl-window.ts');
const { withScreeningRules } = loadLocalTypeScript('lib/screening-context.ts');
const { ledger, postingContext } = loadLocalTypeScript('lib/posting-ledger.ts');

export function openDetailStore(filename) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const schema = readFileSync(new URL('../drizzle/0011_puzzling_living_lightning.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')[0];
  sqlite.exec(schema.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
  sqlite.exec('CREATE INDEX IF NOT EXISTS crawl_details_expiry_idx ON crawl_details(expires_at)');
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...args) {
        return { async all() { return { results: statement.all(...args) }; }, run() { return statement.run(...args); } };
      } };
    },
    async batch(writes) {
      sqlite.exec('BEGIN');
      try { for (const write of writes) write.run(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, prune: () => sqlite.prepare('DELETE FROM crawl_details WHERE expires_at<=?').run(Date.now()), close: () => sqlite.close() };
}

export function createLocalCrawler({ key, filename, execute = executeCrawl, allow = isBuiltInBoard }) {
  const store = openDetailStore(filename);
  const authorization = Buffer.from(`Bearer ${key}`);
  const active = new Map();
  const recent = new Map();
  const peaks = new Map();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  const MB = 1024 * 1024;
  const heapLimitMb = getHeapStatistics().heap_size_limit / MB;
  let requestCap, limit;
  const remember = (map, id, value) => {
    map.delete(id);
    map.set(id, value);
    if (map.size > 128) map.delete(map.keys().next().value);
  };
  function health(runId) {
    const heapUsedMb = process.memoryUsage().heapUsed / MB;
    const runs = new Set([...active.keys()].map(id => id.split(":")[0]));
    if (runId) runs.add(runId);
    for (const run of runs) remember(peaks, run, Math.max(peaks.get(run) ?? 0, heapUsedMb));
    return { active: active.size, heapUsedMb, heapLimitMb, eventLoopLagMs: lag.percentile(99) / 1e6,
      ...(runId ? { heapPeakMb: peaks.get(runId) } : {}) };
  }

  store.prune();
  const pruneTimer = setInterval(store.prune, 3_600_000).unref();
  const sampleTimer = setInterval(() => { health(); }, 1000).unref();
  const server = createServer(async (request, response) => {
    const provided = Buffer.from(request.headers.authorization || "");
    if (provided.length !== authorization.length || !timingSafeEqual(provided, authorization)) {
      response.writeHead(404).end(); return;
    }
    const route = new URL(request.url || "/", "http://127.0.0.1");
    const send = (status, body) => {
      if (response.destroyed) return;
      if (!response.headersSent) response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const validId = /^\d+:\d+$/;
    if (request.method === "GET" && route.pathname === "/health") {
      const runId = route.searchParams.get("runId");
      send(200, health(runId && /^\d+$/.test(runId) ? runId : undefined));
      lag.reset();
      return;
    }
    if (request.method === "GET" && route.pathname === "/status") {
      const id = route.searchParams.get("crawlId") || "";
      const metrics = validId.test(id) ? active.get(id) ?? recent.get(id) : undefined;
      if (!metrics) { send(404, { error: "crawl is unknown" }); return; }
      const { lastRequest, activeRequests, maxResponseBytes, deadlineHit } = metrics;
      send(200, { lastRequest, activeRequests, maxResponseBytes, deadlineHit });
      return;
    }
    if (request.method !== "POST" || route.pathname !== "/crawl") { response.writeHead(404).end(); return; }

    const controller = new AbortController();
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    let id, metrics, runId;
    try {
      // Bound input before allocating a source slot. Only the authenticated Worker submits tasks.
      const chunks = [];
      let bytes = 0;
      if (Number(request.headers["content-length"]) > 1024 * 1024) { send(413, { error: "Local crawler request too large" }); return; }
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { send(413, { error: "Local crawler request too large" }); return; }
        chunks.push(chunk);
      }
      const { source, window, coarse, concurrency, crawlId, deadlineMs, postingLedger } = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
      if (!validId.test(crawlId) || !Number.isSafeInteger(deadlineMs) || !allow(source)) throw new Error("Invalid local crawl request");
      runId = crawlId.split(":")[0];
      const usage = health(runId);
      if (usage.heapUsedMb > usage.heapLimitMb * 0.8) { send(503, { code: "heap", health: usage }); return; }
      if (active.size >= LOCAL_CRAWLER_CAPACITY || active.has(crawlId)) { send(503, { code: "busy", health: usage }); return; }
      id = crawlId;
      metrics = crawlMetrics();
      active.set(id, metrics);
      // Release the Worker's waiting-for-headers slot while the crawl runs.
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      if (!limit || active.size === 1 && requestCap !== concurrency) {
        requestCap = Math.min(24, Math.max(1, Number(concurrency) || 12));
        limit = requestLimiter(requestCap);
      }
      const deadline = Math.max(1, deadlineMs - Date.now() - 5000);
      const context = postingContext(postingLedger?.known, postingLedger?.hasSnapshot);
      const runCrawl = () => execute(store.db, source, { metrics, limit });
      const jobs = await withCrawlWindow(window, () => withDeadline("本地来源抓取", deadline, controller.signal, signal =>
        withSyncSignal(signal, () => withScreeningRules({ coarse, aiPrompt: "" }, () =>
          postingLedger ? ledger.run(context, runCrawl) : runCrawl()))));
      const { observed, rowsSeen, pages, scanComplete, untracked } = context;
      send(200, { jobs, warnings: jobs.warnings, metrics, heapPeakMb: health(runId).heapPeakMb,
        postingScan: postingLedger ? { observed, rowsSeen, pages, scanComplete, untracked } : undefined });
    } catch (error) {
      const sourceDeadline = error instanceof DeadlineError && error.label === "本地来源抓取";
      if (sourceDeadline && metrics) metrics.deadlineHit = true;
      send(200, { jobs: [], metrics, sourceDeadline, heapPeakMb: runId ? health(runId).heapPeakMb : undefined,
        error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (id) {
        active.delete(id);
        remember(recent, id, { lastRequest: metrics.lastRequest, activeRequests: metrics.activeRequests,
          maxResponseBytes: metrics.maxResponseBytes, deadlineHit: metrics.deadlineHit });
      }
    }
  });
  server.on("close", () => {
    clearInterval(pruneTimer);
    clearInterval(sampleTimer);
    lag.disable();
    store.close();
  });
  return server;
}

if (process.send && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.once("message", ({ port, key, filename }) => {
  const server = createLocalCrawler({ key, filename });
  server.listen(port, "127.0.0.1", () => process.send({ port: server.address().port }));
  process.on("disconnect", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
});
