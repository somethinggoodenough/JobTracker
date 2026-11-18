import { resumeId, resumeInput, resumePatch, ResumeInputError, RESUMES_PAGE_SIZE, type ResumeRecord, type ResumeSummary } from "./resume-types";
import { pdfFileName, validateResumePdf } from "./resume-pdf";
type StoredResume = Omit<ResumeRecord, "tech_stack"> & { tech_stack: string; pdf_key: string | null };
export class ResumeConflict extends Error {}
export class ResumeNotFound extends Error {}
function decode<T extends { tech_stack: string; pdf_key?: string | null }>(row: T): Omit<T, "tech_stack" | "pdf_key"> & { tech_stack: string[] } {
  const { pdf_key: _privateKey, tech_stack, ...publicFields } = row;
  return { ...publicFields, tech_stack: JSON.parse(tech_stack) as string[] };
}
type PdfInfo = { key: string; name: string; size: number };
async function storePdf(bucket: R2Bucket | undefined, file: File): Promise<PdfInfo> {
  if (!bucket) throw new Error("Resume storage unavailable");
  const bytes = await validateResumePdf(file), key = `resume-pdfs/${crypto.randomUUID()}.pdf`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" } });
  return { key, name: pdfFileName(file.name), size: bytes.byteLength };
}
async function removePdf(bucket: R2Bucket | undefined, key: string | null | undefined) {
  if (!key || !bucket) return;
  try { await bucket.delete(key); } catch { console.error("Resume PDF storage cleanup failed"); }
}
async function storedResume(db: D1Database, id: number) {
  const row = await db.prepare("SELECT * FROM resumes WHERE id=?1").bind(resumeId(id)).first<StoredResume>();
  if (!row) throw new ResumeNotFound("简历不存在，可能已在其他窗口删除");
  return row;
}
export async function listResumes(db: D1Database, url: URL) {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 200), rawPage = url.searchParams.get("page") || "1";
  const requested = /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? Math.max(1, Number(rawPage)) : 1;
  const where = "(?1='' OR instr(lower(name),lower(?1))>0 OR instr(lower(target_role),lower(?1))>0 OR instr(lower(summary),lower(?1))>0 OR instr(lower(tech_stack),lower(?1))>0)";
  const total = (await db.prepare(`SELECT COUNT(*) AS total FROM resumes WHERE ${where}`).bind(query).first<{ total: number }>())?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / RESUMES_PAGE_SIZE)), page = Math.min(requested, totalPages);
  const rows = await db.prepare(`SELECT id,name,target_role,summary,created_at,tech_stack,pdf_name,pdf_size,version,recorded_at,updated_at FROM resumes
    WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ?2 OFFSET ?3`).bind(query, RESUMES_PAGE_SIZE, (page - 1) * RESUMES_PAGE_SIZE)
    .all<Omit<StoredResume, "content">>();
  return { resumes: rows.results.map(row => decode(row) as ResumeSummary), pagination: { page, pageSize: RESUMES_PAGE_SIZE, total, totalPages } };
}
export async function getResume(db: D1Database, id: number) {
  return decode(await storedResume(db, id));
}
export async function createResume(db: D1Database, payload: unknown, file?: File | null, bucket?: R2Bucket) {
  const now = new Date().toISOString(), data = resumeInput(payload);
  const pdf = file ? await storePdf(bucket, file) : null;
  let row: StoredResume | null;
  try {
    row = await db.prepare(`INSERT INTO resumes(name,target_role,summary,created_at,tech_stack,content,recorded_at,updated_at,pdf_key,pdf_name,pdf_size)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?7,?8,?9,?10) RETURNING *`)
      .bind(data.name, data.target_role, data.summary, data.created_at, JSON.stringify(data.tech_stack), data.content, now, pdf?.key ?? null, pdf?.name ?? null, pdf?.size ?? null).first<StoredResume>();
    if (!row) throw new Error("Resume insert failed");
  } catch (error) { await removePdf(bucket, pdf?.key); throw error; }
  return decode(row);
}
export async function updateResume(db: D1Database, id: number, payload: unknown, file?: File | null, bucket?: R2Bucket) {
  const previous = await storedResume(db, id), data = resumePatch(payload, decode(previous));
  if (previous.version !== data.version) throw new ResumeConflict("简历已在其他窗口更新，请重新打开后编辑");
  if (file !== undefined && previous.pdf_key && !bucket) throw new Error("Resume storage unavailable");
  const uploaded = file ? await storePdf(bucket, file) : null;
  const pdf = file === undefined ? { key: previous.pdf_key, name: previous.pdf_name, size: previous.pdf_size } : uploaded;
  let row: StoredResume | null;
  try {
    row = await db.prepare(`UPDATE resumes SET name=?1,target_role=?2,summary=?3,created_at=?4,tech_stack=?5,content=?6,
      updated_at=?7,version=version+1,pdf_key=?10,pdf_name=?11,pdf_size=?12 WHERE id=?8 AND version=?9 RETURNING *`)
      .bind(data.name, data.target_role, data.summary, data.created_at, JSON.stringify(data.tech_stack), data.content, new Date().toISOString(), id, data.version,
        pdf?.key ?? null, pdf?.name ?? null, pdf?.size ?? null).first<StoredResume>();
    if (!row) { await getResume(db, id); throw new ResumeConflict("简历已在其他窗口更新，请重新打开后编辑"); }
  } catch (error) { await removePdf(bucket, uploaded?.key); throw error; }
  if (file !== undefined) await removePdf(bucket, previous.pdf_key);
  return decode(row);
}
export async function deleteResume(db: D1Database, id: number, version: unknown, bucket?: R2Bucket) {
  const previous = await storedResume(db, id);
  if (previous.version !== resumeId(version)) throw new ResumeConflict("简历已在其他窗口更新，请刷新后再删除");
  if (previous.pdf_key && !bucket) throw new Error("Resume storage unavailable");
  const result = await db.prepare("DELETE FROM resumes WHERE id=?1 AND version=?2").bind(resumeId(id), resumeId(version)).run();
  if (!result.meta.changes) { await getResume(db, id); throw new ResumeConflict("简历已在其他窗口更新，请刷新后再删除"); }
  await removePdf(bucket, previous.pdf_key);
}

export async function resumePdfResponse(db: D1Database, bucket: R2Bucket | undefined, id: number, request: Request) {
  const resume = await storedResume(db, id);
  if (!resume.pdf_key) throw new ResumeNotFound("这份简历尚未上传 PDF");
  if (!bucket) throw new Error("Resume storage unavailable");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = new Headers({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(resume.pdf_name || "resume.pdf").replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "Accept-Ranges": "bytes", "Content-Security-Policy": "frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" });
  let range: { offset: number; length: number } | undefined;
  const rawRange = request.headers.get("range"), size = resume.pdf_size || 0;
  if (rawRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rawRange);
    const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, size - Number(match[2])) : NaN;
    const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    range = { offset: start, length: end - start + 1 };
  }
  const file = await bucket.get(resume.pdf_key, range ? { range } : undefined);
  if (!file) throw new ResumeNotFound("PDF 文件不存在，请重新上传");
  headers.set("Content-Length", String(range?.length ?? file.size));
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size}`);
    return new Response(file.body, { status: 206, headers });
  }
  return new Response(file.body, { headers });
}
export function resumeError(error: unknown) {
  const status = error instanceof ResumeInputError ? 400 : error instanceof ResumeNotFound ? 404 : error instanceof ResumeConflict ? 409 : 500;
  return Response.json({ error: status === 500 ? "简历操作失败，请稍后重试" : (error as Error).message }, { status, headers: { "Cache-Control": "no-store" } });
}
