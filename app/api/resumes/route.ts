import { getD1 } from "@/lib/database";
import { createResume, listResumes, resumeError } from "@/lib/resumes";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try { return Response.json(await listResumes(getD1(), new URL(request.url)), { headers }); }
  catch (error) { return resumeError(error); }
}
export async function POST(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "简历资料格式无效" }, { status: 400, headers }); }
  try { return Response.json({ resume: await createResume(getD1(), payload) }, { status: 201, headers }); }
  catch (error) { return resumeError(error); }
}
