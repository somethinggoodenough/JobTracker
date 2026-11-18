import { getD1 } from "@/lib/database";
import { DEFAULT_SCREENING } from "@/lib/screening-defaults";
import { saveScreeningSettings, screeningSettings, ScreeningConflictError, ScreeningInputError } from "@/lib/screening-settings";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  return Response.json({ settings: await screeningSettings(getD1()), defaults: DEFAULT_SCREENING }, { headers });
}
export async function PATCH(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 100000) throw new ScreeningInputError("筛选设置内容过大");
    const text = await request.text();
    if (text.length > 100000) throw new ScreeningInputError("筛选设置内容过大");
    return Response.json({ settings: await saveScreeningSettings(getD1(), JSON.parse(text)) }, { headers });
  } catch (e) {
    const status = e instanceof ScreeningConflictError ? 409 : e instanceof ScreeningInputError || e instanceof SyntaxError ? 400 : 500;
    return Response.json({ error: status === 500 ? "筛选设置保存失败，请重试" : e instanceof Error ? e.message : "无效设置" }, { status, headers });
  }
}
