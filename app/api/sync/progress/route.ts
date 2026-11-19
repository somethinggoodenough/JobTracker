import { getD1 } from "@/lib/database";
import { recoverStaleSync, SYNC_HEARTBEAT_SOURCE } from "@/lib/sync-lifecycle";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getD1();
    let run = await db.prepare("SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 1")
      .first<{ id: number; status: string }>();
    if (run && ["running", "cancelling"].includes(run.status) && await recoverStaleSync(db, run.id)) {
      run = await db.prepare("SELECT * FROM scrape_runs WHERE id=?1").bind(run.id).first<{ id: number; status: string }>();
    }
    const sources = run ? await db.prepare(`SELECT * FROM scrape_source_progress
      WHERE run_id=?1 AND source_id<>?2 ORDER BY source_id`).bind(run.id, SYNC_HEARTBEAT_SOURCE).all() : { results: [] };
    return Response.json({ run, sources: sources.results, checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "进度读取失败" }, { status: 500 });
  }
}
