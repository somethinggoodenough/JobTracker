import { readApplicationResume, type ApplicationStatus } from "./application-types";
import { careerLevels, jobCategories, readAnalysis, type CareerLevel, type JobCategory } from "./classification-types";
import { assessUsSponsorship } from "./sponsorship";
import { normalizeTechnologies } from "./tech-aliases";

export const GHOST_DAYS = 21;
const DAY = 86_400_000;

export type AnalyticsOutcome = "offer" | "interview" | "screening" | "rejected" | "withdrawn" | "waiting" | "ghosted";
export type AnalyticsItem = {
  id: number;
  company: string;
  title: string;
  appliedAt: string;
  outcome: AnalyticsOutcome;
  rejectedAfterProgress: boolean;
  firstResponseDays: number | null;
  coverage: number | null;
  jdSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  resume: { id: number; name: string; version: number } | null;
  countries: ("CN" | "US")[];
  categories: JobCategory[];
  careerLevel: CareerLevel | null;
  visa: "available" | "unavailable" | "unclear" | null;
  applyLagDays: number | null;
};

export type ApplicationAnalytics = {
  generatedAt: string;
  ghostDays: number;
  tracked: number;
  items: AnalyticsItem[];
};

type AnalyticsEvent = [status: ApplicationStatus, reachedAt: string];
type AnalyticsRow = {
  id: number;
  company: string;
  title: string;
  status: ApplicationStatus;
  applied_at: string | null;
  created_at: string;
  location: string;
  description: string;
  resume_snapshot: string | null;
  ai_analysis: string | null;
  first_seen_at: string | null;
  events: AnalyticsEvent[];
};

const responses = new Set<ApplicationStatus>(["screening", "interview", "offer", "accepted", "rejected"]);
const submitted = new Set<ApplicationStatus>(["applied", ...responses]);

function earliest(events: AnalyticsEvent[], matches: (status: ApplicationStatus) => boolean) {
  return events.reduce((first, [status, reachedAt]) => {
    if (!matches(status)) return first;
    const time = Date.parse(reachedAt);
    return Number.isFinite(time) ? Math.min(first, time) : first;
  }, Infinity);
}

function locationCountries(location: string) {
  const countries: AnalyticsItem["countries"] = [];
  if (/\bUnited States(?: of America)?\b|\bU\.?S\.?A\.?\b|\bU\.S\.(?=\W|$)|\bUS\b|美国|美國/i.test(location)) countries.push("US");
  if (/\b(?:China|PRC)\b|中国|中國/i.test(location)) countries.push("CN");
  return countries;
}

export function buildAnalyticsItem(row: AnalyticsRow, now: Date): AnalyticsItem | null {
  const stages = new Set([row.status, ...row.events.map(([status]) => status)]);
  const explicitApplied = row.applied_at ? Date.parse(row.applied_at) : NaN;
  if (!Number.isFinite(explicitApplied) && ![...stages].some(status => submitted.has(status))) return null;
  const applied = [explicitApplied, earliest(row.events, status => status === "applied"),
    earliest(row.events, () => true), Date.parse(row.created_at)].find(Number.isFinite);
  if (applied === undefined) return null;

  const progress = stages.has("offer") || stages.has("accepted") ? "offer"
    : stages.has("interview") ? "interview" : stages.has("screening") ? "screening" : null;
  const rejected = stages.has("rejected");
  const outcome = progress ?? (rejected ? "rejected" : row.status === "withdrawn" ? "withdrawn"
    : now.getTime() - applied >= GHOST_DAYS * DAY ? "ghosted" : "waiting");
  const firstResponse = earliest(row.events, status => responses.has(status));
  const firstSeen = row.first_seen_at ? Date.parse(row.first_seen_at) : NaN;

  const analysis = readAnalysis(row.ai_analysis);
  const analysisCountries = Array.isArray(analysis?.countries)
    ? [...new Set(analysis.countries.filter(country => country === "CN" || country === "US"))] : [];
  const countries = analysisCountries.length ? analysisCountries : locationCountries(row.location);
  const categories = Array.isArray(analysis?.categories)
    ? [...new Set(analysis.categories.filter(category => Object.hasOwn(jobCategories, category)))] : [];
  const careerLevel = analysis?.careerLevel && Object.hasOwn(careerLevels, analysis.careerLevel) ? analysis.careerLevel : null;
  const visa = countries.includes("US")
    ? readAnalysis(analysis && { ...analysis, countries }, row.description, row.location)?.visaSponsorship?.status
      ?? assessUsSponsorship(row.description, countries, undefined, row.location)?.status ?? null
    : null;

  const resume = readApplicationResume(row.resume_snapshot);
  const jdSkills = normalizeTechnologies(Array.isArray(analysis?.techStack) ? analysis.techStack.map(skill => skill?.name) : []);
  const resumeSkills = new Set(normalizeTechnologies(resume?.tech_stack ?? []));
  const matchedSkills = jdSkills.filter(skill => resumeSkills.has(skill));
  const missingSkills = jdSkills.filter(skill => !resumeSkills.has(skill));
  return {
    id: row.id, company: row.company, title: row.title, appliedAt: new Date(applied).toISOString(),
    outcome, rejectedAfterProgress: !!progress && rejected,
    firstResponseDays: Number.isFinite(firstResponse) ? Math.max(0, (firstResponse - applied) / DAY) : null,
    coverage: resume && jdSkills.length ? matchedSkills.length / jdSkills.length : null,
    jdSkills, matchedSkills, missingSkills,
    resume: resume ? { id: resume.id, name: resume.name, version: resume.version } : null,
    countries, categories, careerLevel, visa,
    applyLagDays: Number.isFinite(firstSeen) ? (applied - firstSeen) / DAY : null,
  };
}

export async function applicationAnalytics(db: D1Database, now = new Date()): Promise<ApplicationAnalytics> {
  const { results } = await db.prepare(`SELECT a.id,a.company,a.title,a.status,a.applied_at,a.created_at,a.location,a.description,
    a.resume_snapshot,a.ai_analysis,COALESCE(d.first_seen_at,j.first_seen_at) first_seen_at,h.events
    FROM applications a
    LEFT JOIN job_discoveries d ON d.identity='fingerprint:'||a.job_key
    LEFT JOIN jobs j ON j.canonical_url=a.canonical_url
    LEFT JOIN (
      SELECT application_id,json_group_array(json_array(status,reached_at)) events
      FROM application_events GROUP BY application_id
    ) h ON h.application_id=a.id
    ORDER BY a.updated_at DESC,a.id DESC`).all<Omit<AnalyticsRow, "events"> & { events: string | null }>();
  const items = results.map(row => buildAnalyticsItem({ ...row, events: row.events ? JSON.parse(row.events) as AnalyticsEvent[] : [] }, now))
    .filter(item => item !== null);
  return { generatedAt: now.toISOString(), ghostDays: GHOST_DAYS, tracked: results.length, items };
}
