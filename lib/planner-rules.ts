import { dayWindow, shiftCalendarDate } from "./crawl-window";

export * from "./planner-types";
import { plannerIntervals, type CardResult, type PlannerSettings } from "./planner-types";

export class PlannerError extends Error {
  constructor(message: string, public status = 400, public details?: { limit: keyof Omit<PlannerSettings, "version">; count: number; max: number }) { super(message); }
}
export function plannerDay(now = new Date()) { return dayWindow(now).date; }
export function plannerWeek(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return shiftCalendarDate(day, -((weekday + 6) % 7));
}
export function plannerDate(value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PlannerError("日期格式无效");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new PlannerError("日期格式无效");
  return value;
}
export const daysBetween = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
export function boundedInteger(value: unknown, min: number, max: number, optional = false): number | null {
  if (optional && (value === null || value === "" || value === undefined)) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new PlannerError("数值超出范围");
  return value;
}
export function pick<T extends string>(value: unknown, choices: readonly T[], optional = false): T | null {
  if (optional && (value === null || value === "" || value === undefined)) return null;
  if (typeof value !== "string" || !choices.includes(value as T)) throw new PlannerError("选项无效");
  return value as T;
}
export function plannerText(value: unknown, length: number, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.trim().length > length || required && !value.trim()) throw new PlannerError("请检查必填项和文字长度");
  return value.trim();
}
export function assertBlock(reason: unknown, date: unknown) {
  if (!reason || !date) throw new PlannerError("卡住时需填写原因和回看日期");
}
export function cardReview(interval: number, result: CardResult, now = new Date()) {
  const index = Math.max(0, plannerIntervals.indexOf(interval));
  const next = result === "forgot" ? 0 : result === "fuzzy" ? index : Math.min(index + 1, plannerIntervals.length - 1);
  return { interval_days: plannerIntervals[next], due_on: shiftCalendarDate(plannerDay(now), plannerIntervals[next]), last_result: result };
}
