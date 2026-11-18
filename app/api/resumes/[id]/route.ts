import { getD1, getResumeBucket } from "@/lib/database";
import { readResumeRequest } from "@/lib/resume-pdf";
import { resumeId } from "@/lib/resume-types";
import { deleteResume, getResume, resumeError, updateResume } from "@/lib/resumes";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ resume: await getResume(getD1(), resumeId((await context.params).id)) }, { headers }); }
  catch (error) { return resumeError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { payload, pdf } = await readResumeRequest(request);
    return Response.json({ resume: await updateResume(getD1(), resumeId((await context.params).id), payload, pdf, getResumeBucket()) }, { headers });
  }
  catch (error) { return resumeError(error); }
}
export async function DELETE(request: Request, context: Context) {
  let payload: { version?: unknown };
  try { payload = await request.json(); } catch { return Response.json({ error: "请提供简历版本后再删除" }, { status: 400, headers }); }
  try { await deleteResume(getD1(), resumeId((await context.params).id), payload?.version, getResumeBucket()); return Response.json({ ok: true }, { headers }); }
  catch (error) { return resumeError(error); }
}
