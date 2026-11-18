import { getD1 } from "./database";
import { ApplicationConflictError, ApplicationInputError, readApplicationResume, type ApplicationRecord } from "./application-types";
import { readAnalysis } from "./classification-types";

export function applicationError(error: unknown) {
  const invalid = error instanceof ApplicationInputError || error instanceof SyntaxError;
  const conflict = error instanceof ApplicationConflictError;
  return Response.json({ error: invalid || conflict ? (error instanceof SyntaxError ? "请求内容不是有效 JSON" : (error as Error).message) : "申请记录操作失败，请重试" }, { status: conflict ? 409 : invalid ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}

export async function applicationDetail(id: number) {
  const db = getD1();
  const application = await db.prepare(`SELECT id,original_job_id,company,title,location,canonical_url,apply_url,description,source_name,
    resume,resume_id,resume_snapshot,email,applied_at,status,status_at,version,created_at,updated_at,ai_analysis FROM applications WHERE id=?1`).bind(id).first<Omit<ApplicationRecord, "resume_snapshot"> & { resume_snapshot: string | null; ai_analysis: string | null }>();
  if (!application) return null;
  const history = await db.prepare("SELECT id,status,reached_at,recorded_at FROM application_events WHERE application_id=?1 ORDER BY id").bind(id).all();
  return { application: { ...application, resume_snapshot: readApplicationResume(application.resume_snapshot), classification: readAnalysis(application.ai_analysis, application.description, application.location) }, history: history.results };
}
