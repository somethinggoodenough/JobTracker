import { env } from "cloudflare:workers";
import { currentCrawlWindow } from "./crawl-window";
import { currentSyncSignal, throwIfSyncCancelled } from "./sync-control";
import { currentScreeningRules } from "./screening-context";
import { executeCrawl, isBuiltInBoard, type LocalCrawlResult } from "./crawl-execution";
import { crawlPerformance, type CrawlMetrics, type LocalCrawlerHealth } from "./crawl-performance";
import type { SourceRecord } from "./job-types";
import { DeadlineError, withDeadline } from "./deadline";
import { WorkdayRateLimitError } from "./workday-rate-limit";

type CrawlOptions = { concurrency: number; crawlId: string; deadlineMs: number; sourceTimeoutMs: number };

export class LocalCrawlerDisconnected extends Error {
  constructor(cause: unknown) {
    super("本地抓取进程连接中断", { cause });
    this.name = "LocalCrawlerDisconnected";
  }
}

function localCrawler() {
  const bindings = env as unknown as Record<string, unknown>;
  const port = Number(bindings.JOB_RADAR_CRAWLER_PORT);
  const key = bindings.JOB_RADAR_CRAWLER_KEY;
  return Number.isInteger(port) && port > 0 && port <= 65535 && typeof key === "string" ? {
    base: `http://127.0.0.1:${port}`, authorization: `Bearer ${key}`,
  } : null;
}

export function usesLocalCrawler(source: SourceRecord) {
  return !!localCrawler() && isBuiltInBoard(source);
}

async function localProbe<T>(path: string, parent?: AbortSignal): Promise<T | null> {
  const local = localCrawler();
  if (!local || parent?.aborted) return null;
  try {
    return await withDeadline("本地抓取进程诊断", 2000, parent, async signal => {
      const response = await fetch(local.base + path, { signal, headers: { authorization: local.authorization } });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); return null; }
      return await response.json() as T;
    });
  } catch { return null; }
}

export const localCrawlerHealth = (runId: number, parent?: AbortSignal) =>
  localProbe<LocalCrawlerHealth>(`/health?runId=${runId}`, parent);

export async function localCrawlerDiagnostics(crawlId: string, runId: number, parent?: AbortSignal) {
  const [status, health] = await Promise.all([
    localProbe<Pick<CrawlMetrics, "lastRequest" | "activeRequests" | "maxResponseBytes">>(
      `/status?crawlId=${encodeURIComponent(crawlId)}`, parent),
    localCrawlerHealth(runId, parent),
  ]);
  return { status, health };
}

export async function crawlForSync(db: D1Database, source: SourceRecord,
  performance: NonNullable<ReturnType<typeof crawlPerformance.getStore>>, options: CrawlOptions) {
  const local = options.concurrency > 0 ? localCrawler() : null;
  if (!local || !isBuiltInBoard(source)) return executeCrawl(db, source, performance);

  let response: Response;
  let result: LocalCrawlResult & { code?: string; health?: LocalCrawlerHealth };
  try {
    response = await fetch(local.base + "/crawl", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: local.authorization },
      body: JSON.stringify({ source, window: currentCrawlWindow(), coarse: currentScreeningRules().coarse,
        concurrency: options.concurrency, crawlId: options.crawlId, deadlineMs: options.deadlineMs }),
      signal: currentSyncSignal(),
    });
    result = await response.json();
  } catch (error) {
    throwIfSyncCancelled();
    throw new LocalCrawlerDisconnected(error);
  }
  throwIfSyncCancelled();
  if (result.metrics) Object.assign(performance.metrics, result.metrics);
  performance.metrics.localHeapPeakMb = result.heapPeakMb ?? result.health?.heapPeakMb ?? 0;
  if (!response.ok) {
    if (response.status === 503 && result.code === "heap") throw new Error("本地抓取进程内存不足");
    if (response.status === 503 && result.code === "busy") throw new Error("本地抓取进程并发槽已满");
    throw new Error(`本地抓取进程返回 HTTP ${response.status}`);
  }
  if (result.sourceDeadline) throw new DeadlineError("单个来源抓取", options.sourceTimeoutMs);
  if (result.metrics?.workdayCooldown) throw new WorkdayRateLimitError(result.metrics.workdayCooldown);
  if (result.error) throw new Error(result.error);
  return Object.assign(result.jobs, result.warnings ? { warnings: result.warnings } : {});
}
