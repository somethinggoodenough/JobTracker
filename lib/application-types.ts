import type { JobAnalysis } from "./classification-types";
export const applicationStatuses = {
  saved: "待申请", applied: "已申请", screening: "筛选中", interview: "面试中",
  offer: "收到 Offer", accepted: "已接受 Offer", rejected: "已拒绝", withdrawn: "已撤回",
} as const;
export type ApplicationStatus = keyof typeof applicationStatuses;
export type ApplicationRecord = {
  id: number; original_job_id: number; company: string; title: string; location: string;
  canonical_url: string; apply_url: string | null; description: string; source_name: string;
  resume: string; email: string; applied_at: string | null; status: ApplicationStatus;
  status_at: string; version: number; created_at: string; updated_at: string;
  classification: JobAnalysis | null;
};
export type ApplicationEvent = { id: number; status: ApplicationStatus; reached_at: string; recorded_at: string };

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && Object.hasOwn(applicationStatuses, value);
}

export class ApplicationInputError extends Error {}

export function positiveId(value: unknown) {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new ApplicationInputError("无效的记录 ID");
  return id;
}

// Require explicit UTC/offset; a timezone-less browser value must be converted before sending.
function timestamp(value: unknown, optional = false): string | null {
  if (optional && (value === null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ApplicationInputError("日期无效，请填写完整日期、时间和时区");
  }
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) > 23) {
    throw new ApplicationInputError("日期无效，请检查年月日和时间");
  }
  return new Date(value).toISOString();
}

export function applicationInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApplicationInputError("无效的申请资料");
  const body = value as Record<string, unknown>;
  if (!isApplicationStatus(body.status)) throw new ApplicationInputError("无效的申请状态");
  if (typeof body.resume !== "string" || body.resume.length > 4000) throw new ApplicationInputError("简历说明最多 4000 字");
  if (typeof body.email !== "string" || body.email.length > 254 || (body.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))) throw new ApplicationInputError("请填写有效邮箱");
  return { resume: body.resume.trim(), email: body.email.trim(), status: body.status,
    appliedAt: timestamp(body.applied_at, true), statusAt: timestamp(body.status_at)!, version: positiveId(body.version) };
}
