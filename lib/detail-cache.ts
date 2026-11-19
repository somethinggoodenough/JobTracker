import { AsyncLocalStorage } from "node:async_hooks";
import { mapPool } from "./crawler-http";
import { crawlPerformance, detailRequest } from "./crawl-performance";
import { throwIfSyncCancelled } from "./sync-control";

const HOUR = 3_600_000;
type CacheRow = { posting_key: string; revision: string; payload: string; expires_at: number };
export const detailCache = new AsyncLocalStorage<{ db: D1Database; namespace: string }>();

export async function mapDetails<T, R>(
  rows: T[], identity: (row: T) => unknown[], load: (row: T) => Promise<R>, concurrency = 4,
  bulkLoad?: (rows: T[]) => Promise<R[]>,
): Promise<R[]> {
  const scope = detailCache.getStore(), metrics = crawlPerformance.getStore()?.metrics;
  const fetch = (row: T) => detailRequest.run(true, () => load(row));
  if (!rows.length) return [];
  if (!scope) return bulkLoad ? detailRequest.run(true, () => bulkLoad(rows)) : mapPool(rows, fetch, concurrency);

  const now = Date.now();
  const entries = rows.map(row => {
    const [id, upstreamRevision, ...fields] = identity(row);
    return { row, key: id == null || id === "" ? "" : String(id), version: JSON.stringify([upstreamRevision, ...fields]),
      expires: now + (upstreamRevision ? 12 : 2) * HOUR };
  });
  const keys = [...new Set(entries.map(e => e.key).filter(Boolean))];
  const cached = new Map<string, CacheRow>();
  for (let start = 0; start < keys.length; start += 40) {
    throwIfSyncCancelled();
    const batch = keys.slice(start, start + 40);
    const result = await scope.db.prepare(`SELECT posting_key,revision,payload,expires_at FROM crawl_details
      WHERE namespace=? AND expires_at>? AND posting_key IN (${batch.map(() => "?").join(",")})`)
      .bind(scope.namespace, now, ...batch).all<CacheRow>();
    for (const row of result.results) cached.set(row.posting_key, row);
  }
  const results: R[] = new Array(rows.length);
  const misses = entries.flatMap((entry, index) => {
    const hit = cached.get(entry.key);
    if (hit?.revision === entry.version) {
      try {
        results[index] = JSON.parse(hit.payload) as R;
        if (metrics) metrics.cacheHits++;
        return [];
      } catch { /* Refresh invalid cached data. */ }
    }
    if (metrics) metrics.cacheMisses++;
    return [{ ...entry, index }];
  });
  throwIfSyncCancelled();
  if (!misses.length) return results;
  const loaded = bulkLoad && misses.length > 20
    ? await detailRequest.run(true, () => bulkLoad(misses.map(entry => entry.row)))
    : await mapPool(misses, entry => fetch(entry.row), concurrency);
  if (loaded.length !== misses.length) throw new Error("招聘详情响应未覆盖所请求的岗位");
  throwIfSyncCancelled();
  const writes: D1PreparedStatement[] = [];
  for (const [i, entry] of misses.entries()) {
    const result = loaded[i];
    results[entry.index] = result;
    if (!entry.key || result == null) continue;
    const payload = JSON.stringify(result);
    if (payload.length > 100_000) continue;
    writes.push(scope.db.prepare(`INSERT INTO crawl_details(namespace,posting_key,revision,payload,expires_at)
      VALUES(?,?,?,?,?) ON CONFLICT(namespace,posting_key) DO UPDATE
      SET revision=excluded.revision,payload=excluded.payload,expires_at=excluded.expires_at`)
      .bind(scope.namespace, entry.key, entry.version, payload, entry.expires));
  }
  for (let start = 0; start < writes.length; start += 30) {
    throwIfSyncCancelled();
    await scope.db.batch(writes.slice(start, start + 30));
  }
  return results;
}
