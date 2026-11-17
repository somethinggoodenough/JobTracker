import { getD1 } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getD1();
    const url = new URL(request.url);
    const search = (url.searchParams.get("q") ?? "").trim();
    const location = (url.searchParams.get("location") ?? "").trim();
    const type = (url.searchParams.get("type") ?? "").trim();
    const conditions = ["j.posted_at > ?1"];
    const bindings: unknown[] = [new Date(Date.now() - 7 * 86_400_000).toISOString()];
    if (search) {
      bindings.push(`%${search}%`);
      conditions.push(`(j.title LIKE ?${bindings.length} OR j.company LIKE ?${bindings.length} OR j.description LIKE ?${bindings.length})`);
    }
    if (location) {
      bindings.push(`%${location}%`);
      conditions.push(`j.location LIKE ?${bindings.length}`);
    }
    if (type) {
      bindings.push(`%${type}%`);
      conditions.push(`(j.workplace_type LIKE ?${bindings.length} OR j.employment_type LIKE ?${bindings.length})`);
    }
    const where = conditions.join(" AND ");
    const jobs = await db.prepare(`SELECT j.*, s.name AS source_name, s.adapter AS source_adapter
      FROM jobs j JOIN sources s ON s.id = j.source_id WHERE ${where}
      ORDER BY j.posted_at DESC, j.id DESC LIMIT 200`).bind(...bindings).all();
    const stats = await db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT company) AS companies,
      SUM(CASE WHEN datetime(first_seen_at) >= datetime('now','-24 hours') THEN 1 ELSE 0 END) AS new_today
      FROM jobs WHERE posted_at > ?1`).bind(bindings[0]).first();
    const latestRun = await db.prepare("SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 1").first();
    return Response.json({ jobs: jobs.results, stats, latestRun });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取职位失败" }, { status: 500 });
  }
}
