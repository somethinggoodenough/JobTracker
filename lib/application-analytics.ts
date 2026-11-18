import { readApplicationResume, type ApplicationStatus } from "./application-types";
import { jobCategories, readAnalysis, type JobCategory } from "./classification-types";

export type Outcomes = { applied: number; advanced: number; rejected: number; open: number };
export type OutcomeGroup = Outcomes & { key: string; label: string };
export type ApplicationAnalytics = {
  tracked: number;
  submitted: Outcomes;
  groups: Record<"resume" | "country" | "role" | "jobStack" | "resumeStack", OutcomeGroup[]>;
};

type AnalyticsRow = {
  status: ApplicationStatus;
  applied_at: string | null;
  location: string;
  resume_snapshot: string | null;
  resume_name: string | null;
  ai_analysis: string | null;
  was_submitted: number;
  was_advanced: number;
  was_rejected: number;
};

const count = (): Outcomes => ({ applied: 0, advanced: 0, rejected: 0, open: 0 });
const nextSteps = new Set<ApplicationStatus>(["screening", "interview", "offer", "accepted"]);
const countryLabels = { CN: "中国", US: "美国" };

function locationCountries(location: string) {
  const countries: ("CN" | "US")[] = [];
  if (/\bUnited States(?: of America)?\b|\bU\.?S\.?A\.?\b|\bU\.S\.(?=\W|$)|\bUS\b|美国|美國/i.test(location)) countries.push("US");
  if (/\b(?:China|PRC)\b|中国|中國/i.test(location)) countries.push("CN");
  return countries;
}

function technologyLabels(names: unknown[]) {
  return names.flatMap(name => {
    if (typeof name !== "string") return [];
    const label = name.trim().normalize("NFKC").replace(/\s+/g, " ");
    return label ? [{ key: label.toLowerCase(), label }] : [];
  });
}

export function summarizeApplications(rows: AnalyticsRow[]): ApplicationAnalytics {
  const submitted = count();
  const groups = {
    resume: new Map<string, OutcomeGroup>(),
    country: new Map<string, OutcomeGroup>(),
    role: new Map<string, OutcomeGroup>(),
    jobStack: new Map<string, OutcomeGroup>(),
    resumeStack: new Map<string, OutcomeGroup>(),
  };
  for (const row of rows) {
    const advanced = !!row.was_advanced || nextSteps.has(row.status);
    const rejected = !!row.was_rejected || row.status === "rejected";
    if (!(row.applied_at || row.was_submitted || row.status === "applied" || advanced || rejected)) continue;
    const add = (item: Outcomes) => {
      item.applied++;
      if (advanced) item.advanced++;
      if (rejected) item.rejected++;
      if (!advanced && !rejected && row.status !== "withdrawn") item.open++;
    };
    add(submitted);
    const resume = readApplicationResume(row.resume_snapshot);
    const analysis = readAnalysis(row.ai_analysis);
    const countries = Array.isArray(analysis?.countries)
      ? analysis.countries.filter(value => Object.hasOwn(countryLabels, value)) : [];
    const roles = Array.isArray(analysis?.categories) ? analysis.categories.filter(role => Object.hasOwn(jobCategories, role)) : [];
    const dimensions = {
      resume: resume ? [{ key: String(resume.id), label: row.resume_name || resume.name }] : [],
      country: (countries.length ? countries : locationCountries(row.location)).map(key => ({ key, label: countryLabels[key] })),
      role: roles.map(key => ({ key, label: jobCategories[key as JobCategory] })),
      jobStack: technologyLabels(Array.isArray(analysis?.techStack) ? analysis.techStack.map(tech => tech?.name) : []),
      resumeStack: technologyLabels(resume?.tech_stack ?? []),
    };
    for (const dimension of Object.keys(groups) as (keyof typeof groups)[]) {
      const labels = dimensions[dimension].length ? dimensions[dimension] : [{
        key: "", label: { resume: "未选择简历", country: "未确认国家", role: "未分类岗位", jobStack: "JD 无技术栈标签", resumeStack: "简历无技术栈标签" }[dimension],
      }];
      const seen = new Set<string>();
      for (const { key, label } of labels) {
        if (seen.has(key)) continue;
        seen.add(key);
        const item = groups[dimension].get(key) ?? { key, label, ...count() };
        add(item);
        groups[dimension].set(key, item);
      }
    }
  }

  const sorted = (map: Map<string, OutcomeGroup>) => [...map.values()].sort((a, b) =>
    Number(!a.key) - Number(!b.key) || b.applied - a.applied || a.label.localeCompare(b.label));
  return { tracked: rows.length, submitted, groups: {
    resume: sorted(groups.resume), country: sorted(groups.country), role: sorted(groups.role),
    jobStack: sorted(groups.jobStack), resumeStack: sorted(groups.resumeStack),
  } };
}

export async function applicationAnalytics(db: D1Database) {
  const { results } = await db.prepare(`SELECT a.status,a.applied_at,a.location,a.resume_snapshot,a.ai_analysis,r.name resume_name,
    COALESCE(h.was_submitted,0) was_submitted,COALESCE(h.was_advanced,0) was_advanced,COALESCE(h.was_rejected,0) was_rejected
    FROM applications a LEFT JOIN resumes r ON r.id=a.resume_id
    LEFT JOIN (
      SELECT application_id, MAX(status IN ('applied','screening','interview','offer','accepted','rejected')) was_submitted,
      MAX(status IN ('screening','interview','offer','accepted')) was_advanced,MAX(status='rejected') was_rejected
      FROM application_events GROUP BY application_id
    ) h ON h.application_id=a.id ORDER BY a.updated_at DESC,a.id DESC`).all<AnalyticsRow>();
  return summarizeApplications(results);
}
