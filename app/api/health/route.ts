import { getD1 } from "@/lib/database";

export async function GET() {
  try {
    await getD1().prepare("SELECT 1").first();
    return Response.json({ ok: true, retentionDays: 7, checkedAt: new Date().toISOString() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "database unavailable" }, { status: 503 });
  }
}
