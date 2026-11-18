export const DEFAULT_DAILY_AI_LIMIT = 100;
export const MAX_DAILY_AI_LIMIT = 1_000_000;
export type AiSettings = { dailyLimit: number | null; updatedAt: string };

export function parseDailyLimit(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).length !== 1 || !("dailyLimit" in payload)) throw new Error("请提供每日 AI 筛选额度");
  const value = (payload as { dailyLimit: unknown }).dailyLimit;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_DAILY_AI_LIMIT)
    throw new Error(`每日额度必须是 0–${MAX_DAILY_AI_LIMIT} 的整数，或选择不设上限`);
  return value;
}

export async function aiSettings(db: D1Database): Promise<AiSettings> {
  const row = await db.prepare("SELECT daily_limit,updated_at FROM ai_settings WHERE id=?1")
    .bind(1).first<{ daily_limit: number | null; updated_at: string }>();
  if (!row) throw new Error("AI 额度设置未初始化，请先应用数据库迁移");
  return { dailyLimit: row.daily_limit, updatedAt: row.updated_at };
}

export async function saveAiSettings(db: D1Database, payload: unknown): Promise<AiSettings> {
  const limit = parseDailyLimit(payload), updatedAt = new Date().toISOString();
  const result = await db.prepare("UPDATE ai_settings SET daily_limit=?1,updated_at=?2 WHERE id=1 RETURNING id")
    .bind(limit, updatedAt).first<{ id: number }>();
  if (!result) throw new Error("AI 额度设置未初始化，请先应用数据库迁移");
  return { dailyLimit: limit, updatedAt };
}
