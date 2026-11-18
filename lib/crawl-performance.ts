import { AsyncLocalStorage } from "node:async_hooks";
import { currentSyncSignal } from "./sync-control";

export function crawlMetrics() {
  return { listRequests: 0, detailRequests: 0, listMs: 0, detailMs: 0,
    cacheHits: 0, cacheMisses: 0, throttled: 0, timeouts: 0, dbMs: 0, crawlMs: 0, aiMs: 0 };
}
export type CrawlMetrics = ReturnType<typeof crawlMetrics>;
type Group = { key: string; limit: number };
type Waiting = { groups: Group[]; launch: () => void };

export function requestLimiter(limit: number) {
  let active = 0;
  const counts = new Map<string, number>();
  const waiting: Waiting[] = [];

  function drain() {
    while (active < limit) {
      const index = waiting.findIndex(({ groups }) => groups.every(g => (counts.get(g.key) ?? 0) < g.limit));
      if (index < 0) return;
      const [item] = waiting.splice(index, 1);
      active++;
      for (const { key } of item.groups) counts.set(key, (counts.get(key) ?? 0) + 1);
      item.launch();
    }
  }

  return async function limitRequest<T>(url: URL, fn: () => Promise<T>, signal = currentSyncSignal()) {
    const host = url.hostname;
    const provider = ["greenhouse.io", "myworkdayjobs.com", "mokahr.com", "ashbyhq.com", "lever.co", "oraclecloud.com"]
      .find(domain => host === domain || host.endsWith(`.${domain}`));
    const groups = [{ key: host, limit: url.pathname.startsWith("/api/pcsx/") ? 1 : 3 }];
    if (provider) groups.push({ key: `provider:${provider}`, limit: 5 });
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const item = { groups, launch: () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      } };
      function abort() {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason);
      }
      signal?.addEventListener("abort", abort, { once: true });
      waiting.push(item);
      drain();
    });
    try {
      signal?.throwIfAborted();
      return await fn();
    } finally {
      active--;
      for (const { key } of groups) {
        const remaining = counts.get(key)! - 1;
        if (remaining) counts.set(key, remaining);
        else counts.delete(key);
      }
      drain();
    }
  };
}

export const crawlPerformance = new AsyncLocalStorage<{ metrics: CrawlMetrics; limit: ReturnType<typeof requestLimiter> }>();
export const detailRequest = new AsyncLocalStorage<boolean>();
