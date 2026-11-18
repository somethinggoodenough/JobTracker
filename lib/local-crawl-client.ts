import { env } from "cloudflare:workers";
import { currentCrawlWindow } from "./crawl-window";
import { currentSyncSignal, throwIfSyncCancelled } from "./sync-control";
import { currentScreeningRules } from "./screening-context";
import { executeCrawl, isBuiltInBoard, type LocalCrawlResult } from "./crawl-execution";
import { crawlPerformance } from "./crawl-performance";
import type { SourceRecord } from "./job-types";

function localCrawler() {
  const bindings = env as unknown as Record<string, unknown>;
  const port = Number(bindings.JOB_RADAR_CRAWLER_PORT);
  const key = bindings.JOB_RADAR_CRAWLER_KEY;
  return Number.isInteger(port) && port > 0 && port <= 65535 && typeof key === "string" ? { port, key } : null;
}

export function usesLocalCrawler(source: SourceRecord) {
  return !!localCrawler() && isBuiltInBoard(source);
}

export async function crawlForSync(db: D1Database, source: SourceRecord, performance: NonNullable<ReturnType<typeof crawlPerformance.getStore>>, concurrency: number) {
  const local = concurrency > 0 ? localCrawler() : null;
  if (!local || !isBuiltInBoard(source)) {
    return executeCrawl(db, source, performance);
  }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${local.port}/crawl`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${local.key}` },
      body: JSON.stringify({ source, window: currentCrawlWindow(), coarse: currentScreeningRules().coarse, concurrency }),
      signal: currentSyncSignal(),
    });
  } catch (error) {
    throwIfSyncCancelled();
    throw new Error("本地抓取进程连接中断，调度器将重试此来源", { cause: error });
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`本地抓取进程返回 HTTP ${response.status}`); }
  const result = await response.json() as LocalCrawlResult;
  Object.assign(performance.metrics, result.metrics);
  if (result.error) throw new Error(result.error);
  return Object.assign(result.jobs, result.warnings ? { warnings: result.warnings } : {});
}
