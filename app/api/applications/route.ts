import { getD1 } from "@/lib/database";
import { applicationDetail, applicationError } from "@/lib/applications";
import { isApplicationStatus, positiveId, ApplicationInputError, readApplicationResume } from "@/lib/application-types";
import { pagination } from "@/lib/job-query";
import { AI_POLICY } from "@/lib/classification-types";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const db = getD1(), url = new URL(request.url);
    const search = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const status = url.searchParams.get("status") || "";
    if (status && !isApplicationStatus(status)) throw new ApplicationInputError("无效的申请状态");
    const where = "(?1='' OR instr(lower(company),lower(?1))>0 OR instr(lower(title),lower(?1))>0 OR instr(lower(email),lower(?1))>0) AND (?2='' OR status=?2)";
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM applications WHERE ${where}`).bind(search, status).first<{ total: number }>();
    const page = Number(url.searchParams.get("page")) || 1;
    const pages = pagination(count?.total ?? 0, Number.isSafeInteger(page) ? Math.max(1, page) : 1);
    const rows = await db.prepare(`SELECT id,original_job_id,company,title,location,canonical_url,apply_url,source_name,
      resume,resume_id,resume_snapshot,email,applied_at,status,status_at,version,created_at,updated_at FROM applications WHERE ${where}
      ORDER BY updated_at DESC,id DESC LIMIT ?3 OFFSET ?4`).bind(search, status, pages.pageSize, pages.offset).all<{ resume_snapshot: string | null }>();
    return Response.json({ applications: rows.results.map(row => ({ ...row, resume_snapshot: readApplicationResume(row.resume_snapshot) })), pagination: pages }, { headers });
  } catch (error) { return applicationError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { jobId?: unknown };
    const jobId = positiveId(body?.jobId), db = getD1(), now = new Date().toISOString();
    const token = crypto.randomUUID();
    // Use both crawl identities, including after an expired posting is collected again.
    const job = await db.prepare("SELECT canonical_url,dedupe_key FROM jobs WHERE id=?1 AND ai_policy=?2 AND json_extract(ai_analysis,'$.accepted')=1").bind(jobId, AI_POLICY).first<{ canonical_url: string; dedupe_key: string }>();
    if (!job) return Response.json({ error: "该职位已过期，请刷新职位列表" }, { status: 404 });
    const results = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO applications
        (original_job_id,job_key,canonical_url,apply_url,company,title,location,description,source_name,status_at,mutation_token,created_at,updated_at,ai_analysis)
        SELECT j.id,j.dedupe_key,j.canonical_url,j.apply_url,j.company,j.title,j.location,j.description,s.name,?2,?3,?2,?2,j.ai_analysis
        FROM jobs j JOIN sources s ON s.id=j.source_id WHERE j.id=?1 AND j.ai_policy=?4`).bind(jobId, now, token, AI_POLICY),
      db.prepare(`INSERT INTO application_events (application_id,status,reached_at,recorded_at)
        SELECT id,status,status_at,created_at FROM applications WHERE (canonical_url=?1 OR job_key=?2)
        AND NOT EXISTS (SELECT 1 FROM application_events WHERE application_id=applications.id)`).bind(job.canonical_url, job.dedupe_key),
      db.prepare("SELECT id FROM applications WHERE canonical_url=?1 OR job_key=?2 LIMIT 1").bind(job.canonical_url, job.dedupe_key),
    ]);
    const id = (results[2].results[0] as { id: number } | undefined)?.id;
    if (!id) return Response.json({ error: "该职位已过期，请刷新职位列表" }, { status: 404 });
    return Response.json({ ...await applicationDetail(id), created: results[0].meta.changes === 1 }, { status: results[0].meta.changes === 1 ? 201 : 200, headers });
  } catch (error) { return applicationError(error); }
}
