import { currentSyncSignal, syncDelay, throwIfSyncCancelled } from "./sync-control";
import { isInCrawlWindow } from "./crawl-window";
import { crawlPerformance, detailRequest } from "./crawl-performance";

export const clean = (value: unknown) => value == null ? "" : String(value).trim();

export function stripHtml(value: unknown): string {
  return clean(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, 40_000);
}

async function bufferResponse(response: Response) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32 * 1024 * 1024) throw new Error("招聘响应超过 32 MiB");
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const copy = new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  Object.defineProperty(copy, "url", { value: response.url });
  return copy;
}

export async function fetchSource(url: string, init: RequestInit = {}) {
  const parsed = new URL(url);
  const performance = crawlPerformance.getStore();
  const metrics = performance?.metrics;
  const detail = detailRequest.getStore();
  for (let attempt = 0; attempt < 3; attempt++) {
    throwIfSyncCancelled();
    let response: Response;
    const request = async () => {
      if (parsed.pathname.startsWith("/api/pcsx/")) await syncDelay(500);
      const timeout = AbortSignal.timeout(20_000);
      const signal = AbortSignal.any([timeout, currentSyncSignal(), init.signal].filter((s): s is AbortSignal => !!s));
      const started = Date.now();
      if (metrics) metrics[detail ? "detailRequests" : "listRequests"]++;
      try {
        const result = await fetch(url, { ...init, signal,
          headers: { "user-agent": "Mozilla/5.0 (compatible; JobRadar/1.0)",
            accept: "application/json,text/html;q=0.9", ...(init.headers ?? {}) } });
        return performance && result.ok ? await bufferResponse(result) : result;
      } catch (error) {
        if (timeout.aborted && metrics) metrics.timeouts++;
        throw error;
      } finally {
        if (metrics) metrics[detail ? "detailMs" : "listMs"] += Date.now() - started;
      }
    };
    try { response = performance ? await performance.limit(parsed, request) : await request(); }
    catch (error) {
      throwIfSyncCancelled();
      throw new Error(`${error instanceof Error ? error.message : "网络请求失败"} · ${parsed.hostname}${parsed.pathname}`, { cause: error });
    }
    if (response.ok || init.redirect === "manual" && [301, 302, 303, 307, 308].includes(response.status)) return response;
    if (response.status === 429 && metrics) metrics.throttled++;
    if (response.status === 429 && attempt < 2) {
      const retry = response.headers.get("Retry-After");
      const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : (attempt + 1) * 3000;
      if (Number.isFinite(delay) && delay >= 0 && delay <= 30000) {
        await response.body?.cancel();
        await syncDelay(delay); continue;
      }
    }
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} · ${parsed.hostname}${parsed.pathname}`);
  }
  throw new Error("请求重试耗尽");
}

export async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetchSource(url, init);
  if (!r.headers.get("content-type")?.includes("json")) throw new Error(`接口返回非 JSON（可能已迁移）：${url}`);
  return r.json();
}

export const recent = isInCrawlWindow;

export async function mapPool<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { throwIfSyncCancelled(); const index = cursor++; results[index] = await fn(items[index]); }
  }));
  const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failure) throw failure.reason;
  return results;
}
