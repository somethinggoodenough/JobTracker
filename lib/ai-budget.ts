import { dayWindow } from "./crawl-window";
import { aiSettings } from "./ai-settings";
export class DailyModelLimit extends Error {
  constructor(limit?: number | null) { super(limit === 0 ? "AI 筛选已暂停：每日额度为 0，可在页面调整后继续" : "今日 AI 额度已用完，候选已排队；可调整每日上限，或等待纽约时间次日恢复"); }
}
export async function dailyModelBudget(db: D1Database, now = new Date()) {
  const window = dayWindow(now);
  const recorded = await db.prepare("SELECT COUNT(*) AS total FROM ai_usage WHERE created_at>=?1 AND created_at<?2")
    .bind(window.start, window.end).first<{ total: number }>();
  await db.prepare(`INSERT INTO ai_daily_budget(day,used) VALUES(?1,?2)
    ON CONFLICT(day) DO UPDATE SET used=MAX(ai_daily_budget.used,excluded.used)`).bind(window.date, recorded?.total ?? 0).run();
  const row = await db.prepare("SELECT used FROM ai_daily_budget WHERE day=?1").bind(window.date).first<{ used: number }>();
  const used = Math.max(row?.used ?? 0, recorded?.total ?? 0);
  const { dailyLimit: limit } = await aiSettings(db);
  return { day: window.date, timeZone: window.timeZone, limit, used, remaining: limit === null ? null : Math.max(0, limit-used), resetsAt: window.end };
}
export async function reserveModelRequest(db: D1Database, now = new Date()) {
  const budget = await dailyModelBudget(db, now);
  if (budget.remaining === 0) throw new DailyModelLimit(budget.limit);
  // Read the current setting inside the atomic reservation: lowering it in another
  // tab takes effect even if this request already read the previous budget.
  const reservation = await db.prepare(`UPDATE ai_daily_budget SET used=used+1 WHERE day=?1
    AND EXISTS(SELECT 1 FROM ai_settings WHERE id=1 AND (daily_limit IS NULL OR ai_daily_budget.used<daily_limit)) RETURNING used`)
    .bind(budget.day).first<{ used: number }>();
  if (!reservation) throw new DailyModelLimit();
  return reservation.used;
}
