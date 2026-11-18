import { getD1 } from "@/lib/database";
import { jobQuery, pagination } from "@/lib/job-query";
import { AI_POLICY, readAnalysis } from "@/lib/classification-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getD1();
    const query = jobQuery(new URL(request.url));
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM jobs j WHERE ${query.where}`)
      .bind(...query.bindings).first<{ total: number }>();
    const pages = pagination(count?.total ?? 0, query.page);
    const jobs = await db.prepare(`SELECT j.*, s.name AS source_name, s.adapter AS source_adapter,
      (SELECT a.id FROM applications a WHERE a.canonical_url=j.canonical_url OR a.job_key=j.dedupe_key LIMIT 1) AS application_id
      FROM jobs j JOIN sources s ON s.id = j.source_id WHERE ${query.where}
      ORDER BY j.posted_at DESC, j.id DESC LIMIT ?${query.bindings.length+1} OFFSET ?${query.bindings.length+2}`)
      .bind(...query.bindings, pages.pageSize, pages.offset).all();
    const stats = await db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT company) AS companies,
      COALESCE(SUM(CASE WHEN publication_verified=1 AND posted_at>=?2 AND posted_at<?3 THEN 1 ELSE 0 END),0) AS new_today
      FROM jobs WHERE posted_at > ?1 AND ai_policy=?4 AND json_extract(ai_analysis,'$.accepted')=1`).bind(query.bindings[0], query.today.start, query.today.end, AI_POLICY).first();
    const latestRun = await db.prepare("SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 1").first();
    const pending = await db.prepare("SELECT COUNT(*) AS total FROM jobs WHERE ai_policy IS NULL OR ai_policy<>?1").bind(AI_POLICY).first<{ total: number }>();
    return Response.json({ jobs: jobs.results.map(row => ({ ...row, classification: readAnalysis(row.ai_analysis, String(row.description || ""), String(row.location || "")) })), stats, latestRun, pagination: pages, today: query.today, pendingReview: pending?.total ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取职位失败" }, { status: 500 });
  }
}
