import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  try { return Response.json(await runSync()); }
  catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  }
}
