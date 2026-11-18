import { getD1 } from "@/lib/database";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const number = Number(new URL(request.url).searchParams.get("page") || 1);
    const requested = Number.isSafeInteger(number) && number > 0 ? number : 1;
    const db = getD1();
    const count = await db.prepare("SELECT COUNT(*) AS total FROM scrape_runs").first<{total:number}>();
    const total = count?.total ?? 0, totalPages = Math.max(1, Math.ceil(total / 20)), page = Math.min(requested, totalPages);
    const rows = await db.prepare("SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 20 OFFSET ?1").bind((page-1)*20).all();
    return Response.json({ runs: rows.results, pagination: { page, pageSize: 20, total, totalPages } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "读取同步记录失败" }, { status: 500 }); }
}
