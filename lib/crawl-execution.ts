import profiles from "@/data/company-adapters.json";
import registry from "@/data/source-registry.json";
import type { SourceRecord } from "./job-types";
import { crawlSource } from "./crawler";
import { crawlPerformance, type CrawlMetrics } from "./crawl-performance";
import { detailCache } from "./detail-cache";
import type { PostingScan } from "./posting-ledger";

export const sourceNamespace = (source: SourceRecord) => JSON.stringify([1, source.id, source.name, source.url, source.adapter]);

// Only repository-defined public boards use the local crawler. User-entered
// URLs continue through the application's existing adapter path.
export function isBuiltInBoard(source: SourceRecord) {
  return [profiles, registry].some(list => list.some(item => item.name === source.name &&
    new URL(item.url).href.replace(/\/$/, "") === source.url.replace(/\/$/, "")));
}

export function executeCrawl(db: D1Database, source: SourceRecord, performance: NonNullable<ReturnType<typeof crawlPerformance.getStore>>) {
  return crawlPerformance.run(performance, () => detailCache.run({ db, namespace: sourceNamespace(source) }, () => crawlSource(source)));
}

export type LocalCrawlResult = { jobs: Awaited<ReturnType<typeof crawlSource>>; warnings?: string[]; metrics?: CrawlMetrics; postingScan?: PostingScan;
  error?: string; sourceDeadline?: boolean; heapPeakMb?: number };
