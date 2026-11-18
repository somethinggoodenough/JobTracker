import { getD1, getResumeBucket } from "@/lib/database";
import { resumeId } from "@/lib/resume-types";
import { resumeError, resumePdfResponse } from "@/lib/resumes";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await resumePdfResponse(getD1(), getResumeBucket(), resumeId((await context.params).id), request); }
  catch (error) { return resumeError(error); }
}
