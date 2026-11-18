import { confirmedUsSponsorship, type UsSponsorship } from "./sponsorship";
export const AI_POLICY = "early-career-cn-us-v1";
// Broader role relevance is a superset of the existing acceptance policy.
// Keep approved jobs visible; invalidate old rejection caches independently.
export const CLASSIFIER_VERSION = "broad-tech-roles-v2";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const jobCategories = {
  backend_distributed: "Backend / Distributed", full_stack: "Full Stack", ai_engineer: "AI Engineer",
  cloud_platform: "Cloud Platform", data_engineer: "Data Engineer", machine_learning: "Machine Learning Engineer",
  inference_infra: "Inference Infra", training_rl_infra: "Training / RL Infra", execution_platform: "Execution Platform",
  ml_compiler_kernel: "ML Compiler / Kernel",
  quant_development: "Quant Development", data_science: "Data Science / Analytics",
  solutions_architect: "Solutions Architect", forward_deployed: "Forward Deployed",
  software_engineering: "Software Engineering", related_technical: "Related Technical Roles",
} as const;
export const careerLevels = { internship: "Internship · 实习", new_grad: "New Grad · 应届", junior: "Junior · 初级" } as const;
export type JobCategory = keyof typeof jobCategories;
export type CareerLevel = keyof typeof careerLevels;
export type JobAnalysis = {
  accepted: true; categories: JobCategory[]; careerLevel: CareerLevel; countries: ("CN" | "US")[];
  techStack: { name: string; evidence: string }[];
  roleEvidence: string; levelEvidence: string; locationEvidence: string; reason: string;
  usSponsorship?: UsSponsorship;
};
export type JobDecision = JobAnalysis | { accepted: false; reason: string };
export function readAnalysis(value: unknown, description?: string, location = ""): JobAnalysis | null {
  try {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    if (data?.accepted !== true) return null;
    if (description === undefined) return data as JobAnalysis;
    const { usSponsorship: claim, ...analysis } = data;
    const sponsorship = confirmedUsSponsorship(description, analysis.countries || [], claim, location);
    return { ...analysis, ...(sponsorship ? { usSponsorship: sponsorship } : {}) } as JobAnalysis;
  } catch { return null; }
}
