import { getD1 } from "@/lib/database";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId)) return Response.json({ error: "无效来源" }, { status: 400 });
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM jobs WHERE source_id=?1").bind(sourceId),
    db.prepare("DELETE FROM sources WHERE id=?1").bind(sourceId),
  ]);
  return Response.json({ ok: true });
}
