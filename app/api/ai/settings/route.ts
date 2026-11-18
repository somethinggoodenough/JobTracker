import { getD1 } from "@/lib/database";
import { aiSettings, parseDailyLimit, saveAiSettings } from "@/lib/ai-settings";
import { dailyModelBudget } from "@/lib/ai-budget";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await aiSettings(getD1()), { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); parseDailyLimit(payload); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "额度格式无效" }, { status: 400 }); }
  const db = getD1(), settings = await saveAiSettings(db, payload);
  return Response.json({ settings, dailyBudget: await dailyModelBudget(db) }, { headers: { "Cache-Control": "no-store" } });
}
