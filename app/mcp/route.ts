import { getD1 } from "@/lib/database";
import { runSync } from "@/lib/sync";

const tools = [
  { name: "sync_jobs", description: "抓取全部已启用职位来源、去重入库，并删除发布已满 7 天的职位。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_job_stats", description: "读取求职雷达当前职位、公司、来源数量及最近一次同步状态。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

function result(id: unknown, value: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result: value });
}

export async function POST(request: Request) {
  const body = await request.json() as { id?: unknown; method?: string; params?: { name?: string } };
  try {
    if (body.method === "server/discover") return result(body.id, { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
    if (body.method === "tools/list") return result(body.id, { tools });
    if (body.method === "tools/call" && body.params?.name === "sync_jobs") {
      const summary = await runSync();
      return result(body.id, { content: [{ type: "text", text: JSON.stringify(summary) }] });
    }
    if (body.method === "tools/call" && body.params?.name === "get_job_stats") {
      const db = getD1();
      const stats = await db.prepare(`SELECT COUNT(*) AS jobs, COUNT(DISTINCT company) AS companies,
        COUNT(DISTINCT source_id) AS sources FROM jobs`).first();
      const latest = await db.prepare("SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 1").first();
      return result(body.id, { content: [{ type: "text", text: JSON.stringify({ ...stats, latest }) }] });
    }
    return result(body.id, { content: [{ type: "text", text: "未知工具或方法" }], isError: true });
  } catch (error) {
    return result(body.id, { content: [{ type: "text", text: error instanceof Error ? error.message : "工具执行失败" }], isError: true });
  }
}
