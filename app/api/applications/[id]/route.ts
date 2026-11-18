import { getD1 } from "@/lib/database";
import { applicationDetail, applicationError } from "@/lib/applications";
import { applicationInput, positiveId, type ApplicationRecord } from "@/lib/application-types";
import { selectedApplicationResume } from "@/lib/application-resume";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: Context) {
  try {
    const detail = await applicationDetail(positiveId((await context.params).id));
    return detail ? Response.json(detail, { headers }) : Response.json({ error: "申请记录不存在" }, { status: 404 });
  } catch (error) { return applicationError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const id = positiveId((await context.params).id), input = applicationInput(await request.json()), db = getD1();
    const previous = await db.prepare("SELECT status,status_at,version FROM applications WHERE id=?1").bind(id).first<ApplicationRecord>();
    if (!previous) return Response.json({ error: "申请记录不存在" }, { status: 404 });
    if (previous.version !== input.version) return Response.json({ error: "此记录已在其他窗口更新，请重新打开后再编辑" }, { status: 409 });
    const snapshot = await selectedApplicationResume(db, input.resumeChoice);
    const now = new Date().toISOString(), token = crypto.randomUUID();
    const statements = [db.prepare(`UPDATE applications SET resume=?2,email=?3,applied_at=?4,status=?5,status_at=?6,
      updated_at=?7,version=version+1,mutation_token=?8,
      resume_id=CASE WHEN ?10=1 THEN ?11 ELSE resume_id END,
      resume_snapshot=CASE WHEN ?10=1 THEN ?12 ELSE resume_snapshot END
      WHERE id=?1 AND version=?9 AND (?10=0 OR ?11 IS NULL OR EXISTS(SELECT 1 FROM resumes WHERE id=?11 AND version=?13))`)
      .bind(id, input.resume, input.email, input.appliedAt, input.status, input.statusAt, now, token, input.version,
        input.resumeChoice.changed ? 1 : 0, input.resumeChoice.id, snapshot ? JSON.stringify(snapshot) : null, input.resumeChoice.version)];
    if (previous.status !== input.status) {
      statements.push(db.prepare(`INSERT INTO application_events (application_id,status,reached_at,recorded_at)
        SELECT id,status,status_at,?2 FROM applications WHERE id=?1 AND mutation_token=?3`).bind(id, now, token));
    } else if (previous.status_at !== input.statusAt) {
      statements.push(db.prepare(`UPDATE application_events SET reached_at=?2,recorded_at=?3
        WHERE id=(SELECT MAX(id) FROM application_events WHERE application_id=?1)
        AND EXISTS (SELECT 1 FROM applications WHERE id=?1 AND mutation_token=?4)`).bind(id, input.statusAt, now, token));
    }
    const result = await db.batch(statements);
    if (!result[0].meta.changes) return Response.json({ error: "此记录或所选简历已在其他窗口更新，请刷新后重新选择" }, { status: 409 });
    return Response.json(await applicationDetail(id), { headers });
  } catch (error) { return applicationError(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const id = positiveId((await context.params).id);
    const result = await getD1().prepare("DELETE FROM applications WHERE id=?1").bind(id).run();
    return result.meta.changes ? Response.json({ ok: true }) : Response.json({ error: "申请记录不存在" }, { status: 404 });
  } catch (error) { return applicationError(error); }
}
