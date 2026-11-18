import { getD1 } from "@/lib/database";

export async function POST(request: Request) {
  try {
    const data = await request.json() as { runId?: number };
    if (!Number.isSafeInteger(data.runId) || Number(data.runId) <= 0) {
      return Response.json({ error: "请提供要取消的同步任务 ID" }, { status: 400 });
    }
    const db = getD1();
    await db.prepare("UPDATE scrape_runs SET status='cancelling' WHERE id=?1 AND status='running'")
      .bind(data.runId).run();
    const run = await db.prepare("SELECT id,status FROM scrape_runs WHERE id=?1")
      .bind(data.runId).first<{ id: number; status: string }>();
    if (!run) return Response.json({ error: "同步任务不存在" }, { status: 404 });
    return Response.json({ ok: true, runId: run.id, status: run.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "取消同步失败" }, { status: 400 });
  }
}
