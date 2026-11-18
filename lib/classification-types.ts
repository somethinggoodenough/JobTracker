export const AI_POLICY = "early-career-cn-us-v1";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const jobCategories = {
  backend_distributed: "Backend / Distributed", full_stack: "Full Stack", ai_engineer: "AI Engineer",
  cloud_platform: "Cloud Platform", data_engineer: "Data Engineer", machine_learning: "Machine Learning Engineer",
  inference_infra: "Inference Infra", training_rl_infra: "Training / RL Infra", execution_platform: "Execution Platform",
  ml_compiler_kernel: "ML Compiler / Kernel",
} as const;
export const careerLevels = { internship: "Internship · 实习", new_grad: "New Grad · 应届", junior: "Junior · 初级" } as const;
export type JobCategory = keyof typeof jobCategories;
export type CareerLevel = keyof typeof careerLevels;
export type JobAnalysis = {
  accepted: true; categories: JobCategory[]; careerLevel: CareerLevel; countries: ("CN" | "US")[];
  techStack: { name: string; evidence: string }[];
  roleEvidence: string; levelEvidence: string; locationEvidence: string; reason: string;
};
export type JobDecision = JobAnalysis | { accepted: false; reason: string };
export function readAnalysis(value: unknown): JobAnalysis | null {
  try { const data = typeof value === "string" ? JSON.parse(value) : value; return data?.accepted === true ? data as JobAnalysis : null; } catch { return null; }
}
