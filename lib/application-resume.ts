import { ApplicationConflictError, ApplicationInputError, type ApplicationResumeSnapshot } from "./application-types";

export async function selectedApplicationResume(db: D1Database, choice: { changed: boolean; id: number | null; version: number | null }): Promise<ApplicationResumeSnapshot | null> {
  if (!choice.changed || choice.id === null) return null;
  const resume = await db.prepare("SELECT id,name,target_role,created_at,version,tech_stack,pdf_name FROM resumes WHERE id=?1")
    .bind(choice.id).first<Omit<ApplicationResumeSnapshot, "tech_stack" | "selected_at"> & { tech_stack: string }>();
  if (!resume) throw new ApplicationInputError("所选简历已删除，请从简历库重新选择");
  if (resume.version !== choice.version) throw new ApplicationConflictError("所选简历已更新，请刷新简历列表后重新选择版本");
  return { ...resume, tech_stack: JSON.parse(resume.tech_stack) as string[], selected_at: new Date().toISOString() };
}
