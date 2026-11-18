import { getD1, getResumeBucket } from "@/lib/database";
import { createResume, listResumes, resumeError } from "@/lib/resumes";
import { readResumeRequest } from "@/lib/resume-pdf";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try { return Response.json(await listResumes(getD1(), new URL(request.url)), { headers }); }
  catch (error) { return resumeError(error); }
}
export async function POST(request: Request) {
  try {
    const { payload, pdf } = await readResumeRequest(request);
    return Response.json({ resume: await createResume(getD1(), payload, pdf, getResumeBucket()) }, { status: 201, headers });
  }
  catch (error) { return resumeError(error); }
}
