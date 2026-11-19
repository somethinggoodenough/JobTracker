export const WORKDAY_REQUEST_GAP_MS = 750;

export function isWorkdayHost(host: string) {
  return host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com");
}

export type WorkdayRateLimit = { address: string; retryAfter: string | null; retryAt: number | null };

export function workdayRateLimit(url: URL, header: string | null, now = Date.now()): WorkdayRateLimit {
  const retryAfter = header?.trim().slice(0, 128) || null;
  let retryAt: number | null = null;
  if (retryAfter) {
    const candidate = /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000
      : /[a-z]/i.test(retryAfter) ? Date.parse(retryAfter) : NaN;
    if (Number.isFinite(candidate) && Math.abs(candidate) <= 8.64e15) retryAt = Math.max(candidate, now);
  }
  return { address: url.host + url.pathname, retryAfter, retryAt };
}

export class WorkdayRateLimitError extends Error {
  constructor(public cooldown: WorkdayRateLimit) {
    super(`HTTP 429 · ${cooldown.address}`);
    this.name = "WorkdayRateLimitError";
  }
}

export function readWorkdayCooldown(db: D1Database, now = Date.now()) {
  return db.prepare(`SELECT address, retry_after AS retryAfter, retry_at AS retryAt
    FROM crawl_provider_cooldowns WHERE provider='workday' AND retry_at>?1`).bind(now).first<WorkdayRateLimit>();
}

export async function saveWorkdayCooldown(db: D1Database, cooldown: WorkdayRateLimit) {
  if (cooldown.retryAt === null || cooldown.retryAt <= Date.now()) return;
  await db.prepare(`INSERT INTO crawl_provider_cooldowns(provider,address,retry_after,retry_at) VALUES ('workday',?1,?2,?3)
    ON CONFLICT(provider) DO UPDATE SET address=excluded.address,retry_after=excluded.retry_after,retry_at=excluded.retry_at
    WHERE excluded.retry_at>crawl_provider_cooldowns.retry_at`).bind(cooldown.address, cooldown.retryAfter, cooldown.retryAt).run();
}
