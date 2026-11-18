import { resumeId, resumeInput, resumePatch, ResumeInputError, RESUMES_PAGE_SIZE, type ResumeRecord, type ResumeSummary } from "./resume-types";
type StoredResume = Omit<ResumeRecord, "tech_stack"> & { tech_stack: string };
export class ResumeConflict extends Error {}
export class ResumeNotFound extends Error {}
function decode<T extends { tech_stack: string }>(row: T): Omit<T, "tech_stack"> & { tech_stack: string[] } {
  return { ...row, tech_stack: JSON.parse(row.tech_stack) as string[] };
}
export async function listResumes(db: D1Database, url: URL) {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 200), rawPage = url.searchParams.get("page") || "1";
  const requested = /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? Math.max(1, Number(rawPage)) : 1;
  const where = "(?1='' OR instr(lower(name),lower(?1))>0 OR instr(lower(target_role),lower(?1))>0 OR instr(lower(summary),lower(?1))>0 OR instr(lower(tech_stack),lower(?1))>0)";
  const total = (await db.prepare(`SELECT COUNT(*) AS total FROM resumes WHERE ${where}`).bind(query).first<{ total: number }>())?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / RESUMES_PAGE_SIZE)), page = Math.min(requested, totalPages);
  const rows = await db.prepare(`SELECT id,name,target_role,summary,created_at,tech_stack,version,recorded_at,updated_at FROM resumes
    WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ?2 OFFSET ?3`).bind(query, RESUMES_PAGE_SIZE, (page - 1) * RESUMES_PAGE_SIZE)
    .all<Omit<StoredResume, "content">>();
  return { resumes: rows.results.map(row => decode(row) as ResumeSummary), pagination: { page, pageSize: RESUMES_PAGE_SIZE, total, totalPages } };
}
export async function getResume(db: D1Database, id: number) {
  const row = await db.prepare("SELECT * FROM resumes WHERE id=?1").bind(resumeId(id)).first<StoredResume>();
  if (!row) throw new ResumeNotFound("简历不存在，可能已在其他窗口删除");
  return decode(row);
}
export async function createResume(db: D1Database, payload: unknown) {
  const now = new Date().toISOString(), data = resumeInput(payload);
  const result = await db.prepare(`INSERT INTO resumes(name,target_role,summary,created_at,tech_stack,content,recorded_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?7)`).bind(data.name, data.target_role, data.summary, data.created_at, JSON.stringify(data.tech_stack), data.content, now).run();
  return getResume(db, Number(result.meta.last_row_id));
}
export async function updateResume(db: D1Database, id: number, payload: unknown) {
  const previous = await getResume(db, id), data = resumePatch(payload, previous);
  const row = await db.prepare(`UPDATE resumes SET name=?1,target_role=?2,summary=?3,created_at=?4,tech_stack=?5,content=?6,
    updated_at=?7,version=version+1 WHERE id=?8 AND version=?9 RETURNING *`)
    .bind(data.name, data.target_role, data.summary, data.created_at, JSON.stringify(data.tech_stack), data.content, new Date().toISOString(), id, data.version).first<StoredResume>();
  if (!row) { await getResume(db, id); throw new ResumeConflict("简历已在其他窗口更新，请重新打开后编辑"); }
  return decode(row);
}
export async function deleteResume(db: D1Database, id: number, version: unknown) {
  const result = await db.prepare("DELETE FROM resumes WHERE id=?1 AND version=?2").bind(resumeId(id), resumeId(version)).run();
  if (!result.meta.changes) { await getResume(db, id); throw new ResumeConflict("简历已在其他窗口更新，请刷新后再删除"); }
}
export function resumeError(error: unknown) {
  const status = error instanceof ResumeInputError ? 400 : error instanceof ResumeNotFound ? 404 : error instanceof ResumeConflict ? 409 : 500;
  return Response.json({ error: status === 500 ? "简历操作失败，请稍后重试" : (error as Error).message }, { status, headers: { "Cache-Control": "no-store" } });
}
