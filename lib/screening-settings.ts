import { DEFAULT_SCREENING, type CoarseFilter, type ScreeningRules } from "./screening-defaults";
export type ScreeningSettings = ScreeningRules & { version: number; updatedAt: string };
export class ScreeningInputError extends Error {}
export class ScreeningConflictError extends Error {}
const invalid = (message: string): never => { throw new ScreeningInputError(message); };
export function parseScreeningInput(payload: unknown): ScreeningRules & { version: number } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return invalid("筛选设置格式无效");
  const p = payload as Record<string, unknown>;
  if (Object.keys(p).some(k => !["coarse", "aiPrompt", "version"].includes(k)) || !Number.isSafeInteger(p.version) || Number(p.version) < 1) return invalid("请提供有效的设置版本");
  if (typeof p.aiPrompt !== "string" || !p.aiPrompt.trim() || p.aiPrompt.length > 16000) return invalid("AI prompt 不能为空，且最多 16000 个字符");
  if (!p.coarse || typeof p.coarse !== "object" || Array.isArray(p.coarse)) return invalid("粗筛条件格式无效");
  const raw = p.coarse as Record<string, unknown>, coarse = {} as CoarseFilter;
  if (Object.keys(raw).length !== Object.keys(DEFAULT_SCREENING.coarse).length || Object.keys(raw).some(k => !(k in DEFAULT_SCREENING.coarse))) return invalid("粗筛条件字段不完整或含有未知字段");
  for (const [key, value] of Object.entries(DEFAULT_SCREENING.coarse)) {
    const input = raw[key];
    if (typeof value === "boolean") {
      if (typeof input !== "boolean") return invalid("粗筛开关必须为布尔值");
      (coarse as Record<string, unknown>)[key] = input;
    } else if (key === "maxRequiredYears") {
      if (input !== null && (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 || input > 30)) return invalid("经验阈值必须为 0–30 的整数，或不限制");
      coarse.maxRequiredYears = input as number | null;
    } else {
      if (!Array.isArray(input) || input.length > 50 || input.some(v => typeof v !== "string" || !v.trim() || v.length > 80)) return invalid("每组关键词最多 50 个，每个最多 80 字符");
      (coarse as Record<string, unknown>)[key] = [...new Set((input as string[]).map(v => v.trim()).filter(Boolean))];
    }
  }
  return { coarse, aiPrompt: p.aiPrompt.trim(), version: Number(p.version) };
}
export async function screeningSettings(db: D1Database): Promise<ScreeningSettings> {
  const row = await db.prepare("SELECT coarse_json,ai_prompt,version,updated_at FROM screening_settings WHERE id=1")
    .first<{ coarse_json: string; ai_prompt: string | null; version: number; updated_at: string }>();
  if (!row) throw new Error("筛选设置未初始化，请先应用数据库迁移");
  const parsed = parseScreeningInput({ coarse: { ...DEFAULT_SCREENING.coarse, ...JSON.parse(row.coarse_json) }, aiPrompt: row.ai_prompt ?? DEFAULT_SCREENING.aiPrompt, version: row.version });
  return { ...parsed, updatedAt: row.updated_at };
}
export async function saveScreeningSettings(db: D1Database, payload: unknown): Promise<ScreeningSettings> {
  const parsed = parseScreeningInput(payload), updatedAt = new Date().toISOString();
  const row = await db.prepare("UPDATE screening_settings SET coarse_json=?1,ai_prompt=?2,version=version+1,updated_at=?3 WHERE id=1 AND version=?4 RETURNING version")
    .bind(JSON.stringify(parsed.coarse), parsed.aiPrompt, updatedAt, parsed.version).first<{ version: number }>();
  if (!row) throw new ScreeningConflictError("设置已在其他页面更新，请重新加载后再保存");
  // Reconsider failed queued candidates under new preferences without altering daily usage or saved jobs.
  await db.prepare("UPDATE job_candidates SET next_retry_at=?1,last_error=NULL").bind(updatedAt).run();
  return { coarse: parsed.coarse, aiPrompt: parsed.aiPrompt, version: row.version, updatedAt };
}
