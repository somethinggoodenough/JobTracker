import { AsyncLocalStorage } from "node:async_hooks";

export const JOB_TIME_ZONE = "America/New_York";
export type CrawlWindow = { date: string; start: string; end: string; timeZone: string };
const windows = new AsyncLocalStorage<CrawlWindow>();
const calendarCache = new WeakMap<CrawlWindow, Map<string, number>>();
function parts(date: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
export function shiftCalendarDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function midnight(date: string, timeZone: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let time = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(time), timeZone);
    const difference = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    time += difference;
    if (!difference) break;
  }
  return new Date(time).toISOString();
}
export function dayWindow(now = new Date(), timeZone = JOB_TIME_ZONE): CrawlWindow {
  const p = parts(now, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { date, start: midnight(date, timeZone), end: midnight(shiftCalendarDate(date, 1), timeZone), timeZone };
}
export const currentCrawlWindow = () => windows.getStore() ?? dayWindow();
export const withCrawlWindow = <T>(window: CrawlWindow, fn: () => T): T => windows.run(window, fn);
// Calendar-only dates refer to that day, rather than UTC midnight (yesterday in New York).
export function publicationTime(value: string | null | undefined, window = currentCrawlWindow()): number {
  if (!value) return NaN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== value) return NaN;
  let cache = calendarCache.get(window);
  if (!cache) { cache = new Map(); calendarCache.set(window, cache); }
  if (!cache.has(value)) cache.set(value, Date.parse(midnight(value, window.timeZone)));
  return cache.get(value)!;
}
export function isInCrawlWindow(value?: string | null, window = currentCrawlWindow()) {
  const time = publicationTime(value, window);
  return Number.isFinite(time) && time >= Date.parse(window.start) && time < Date.parse(window.end);
}
export function isOlderThanCrawlWindow(value?: string | null) {
  const time = publicationTime(value);
  return Number.isFinite(time) && time < Date.parse(currentCrawlWindow().start);
}
