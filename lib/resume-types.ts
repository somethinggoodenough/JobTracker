export const RESUME_TIME_ZONE = "America/New_York";
export const RESUMES_PAGE_SIZE = 12;
export type ResumeRecord = {
  id: number; name: string; target_role: string; summary: string; created_at: string;
  tech_stack: string[]; content: string; version: number; recorded_at: string; updated_at: string;
  pdf_name: string | null; pdf_size: number | null;
};
export type ResumeSummary = Omit<ResumeRecord, "content">;
export class ResumeInputError extends Error {}

export function resumeId(value: unknown): number {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new ResumeInputError("无效的简历 ID 或版本");
  return id;
}

const fields = ["name", "target_role", "summary", "created_at", "tech_stack", "content"] as const;
function object(value: unknown, patch = false): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResumeInputError("简历资料格式无效");
  if (Object.keys(value).some(key => !fields.includes(key as typeof fields[number]) && !(patch && key === "version")))
    throw new ResumeInputError("简历资料包含不支持的字段");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw new ResumeInputError(`${label}${required ? "不能为空，且" : ""}最多 ${max} 字`);
  return value.trim();
}
function techStack(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new ResumeInputError("技术栈最多 40 个标签");
  const tags = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length > 60) throw new ResumeInputError("每个技术栈标签最多 60 字");
    const normalized = item.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (normalized) tags.set(normalized.toLowerCase(), tags.get(normalized.toLowerCase()) || normalized);
  }
  if (tags.size > 40) throw new ResumeInputError("技术栈最多 40 个标签");
  return [...tags.values()];
}
function timestamp(value: unknown, now: Date) {
  if (value === undefined) return now.toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value)) || Number(value.slice(11, 13)) > 23) throw new ResumeInputError("请填写有效的简历创建时间和时区");
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new ResumeInputError("简历创建日期无效");
  return new Date(value).toISOString();
}
export function resumeInput(value: unknown, now = new Date()) {
  const body = object(value);
  return { name: text(body.name, "简历名称", 120, true), target_role: text(body.target_role, "目标岗位", 160, true),
    summary: text(body.summary, "简短说明", 500), created_at: timestamp(body.created_at, now),
    tech_stack: techStack(body.tech_stack), content: text(body.content, "简历正文", 100_000) };
}
export function resumePatch(value: unknown, previous: ResumeRecord) {
  const body = object(value, true), version = resumeId(body.version);
  const merged: Record<string, unknown> = {};
  for (const key of fields) merged[key] = Object.hasOwn(body, key) ? body[key] : previous[key];
  return { ...resumeInput(merged), version };
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: RESUME_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function resumeLocalTime(value: string): string {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
// Interpret the editor's wall clock as New York time, independently of the device timezone.
export function resumeLocalToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new ResumeInputError("请填写完整的简历创建时间");
  const wall = value.length === 16 ? `${value}:00` : value;
  const target = Date.parse(`${wall}Z`);
  if (!Number.isFinite(target)) throw new ResumeInputError("简历创建时间无效");
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const represented = resumeLocalTime(new Date(guess).toISOString());
    if (represented === wall) return new Date(guess).toISOString();
    guess += target - Date.parse(`${represented}Z`);
  }
  throw new ResumeInputError("该纽约时间不存在，请检查日期或夏令时切换时间");
}
