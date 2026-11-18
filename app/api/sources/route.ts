import { normalizeSource } from "@/lib/crawler";
import { getD1 } from "@/lib/database";
import type { SourceAdapter } from "@/lib/job-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await getD1().prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM jobs j WHERE j.source_id=s.id) AS job_count
      FROM sources s ORDER BY s.created_at DESC`).all();
    return Response.json({ sources: rows.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取来源失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { name?: string; url?: string; adapter?: SourceAdapter; enabled?: boolean; lastError?: string };
    const name = payload.name?.trim();
    const inputUrl = payload.url?.trim();
    if (!name || !inputUrl) return Response.json({ error: "公司名称和招聘网站 URL 必填" }, { status: 400 });
    const normalized = normalizeSource(inputUrl, payload.adapter ?? "auto");
    const result = await getD1().prepare(`INSERT INTO sources (name,url,adapter,enabled,last_error,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?6)`).bind(name, normalized.canonicalInput, normalized.adapter,
        payload.enabled === false ? 0 : 1, payload.lastError?.slice(0, 500) || null, new Date().toISOString()).run();
    return Response.json({ id: result.meta.last_row_id, adapter: normalized.adapter }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "添加来源失败";
    return Response.json({ error: /UNIQUE/i.test(message) ? "这个来源已经添加过了" : message }, { status: 400 });
  }
}
