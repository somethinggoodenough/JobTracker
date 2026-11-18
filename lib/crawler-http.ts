import { currentSyncSignal, syncDelay, throwIfSyncCancelled } from "./sync-control";
import { isInCrawlWindow } from "./crawl-window";

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

const hostQueues = new Map<string, Promise<void>>();
export async function fetchSource(url: string, init: RequestInit = {}) {
  const parsed = new URL(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    throwIfSyncCancelled();
    if (parsed.pathname.startsWith("/api/pcsx/")) {
      const previous = hostQueues.get(parsed.host) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(() => syncDelay(500));
      hostQueues.set(parsed.host, next); await next;
    }
    throwIfSyncCancelled();
    const signal = AbortSignal.any([AbortSignal.timeout(20_000), currentSyncSignal(), init.signal].filter((s): s is AbortSignal => !!s));
    let response: Response;
    try { response = await fetch(url, { ...init, signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; JobRadar/1.0)",
        accept: "application/json,text/html;q=0.9", ...(init.headers ?? {}) } }); }
    catch (error) {
      throwIfSyncCancelled();
      throw new Error(`${error instanceof Error ? error.message : "网络请求失败"} · ${parsed.hostname}${parsed.pathname}`, { cause: error });
    }
    if (response.ok || init.redirect === "manual" && [301, 302, 303, 307, 308].includes(response.status)) return response;
    if (response.status === 429 && attempt < 2) {
      const retry = response.headers.get("Retry-After");
      const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : (attempt + 1) * 3000;
      if (Number.isFinite(delay) && delay >= 0 && delay <= 30000) {
        await response.body?.cancel();
        await syncDelay(delay); continue;
      }
    }
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
