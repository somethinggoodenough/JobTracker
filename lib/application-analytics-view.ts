import type { AnalyticsItem, AnalyticsOutcome } from "./application-analytics";
import { careerLevels, jobCategories } from "./classification-types";

export const OUTCOME_STYLE = {
  offer: { label: "Offer", color: "#154778", outline: "none" },
  interview: { label: "面试", color: "#277bbd", outline: "none" },
  screening: { label: "筛选", color: "#83bce9", outline: "none" },
  rejected: { label: "被拒", color: "#c9733e", outline: "none" },
  ghosted: { label: "没回音", color: "#b8bdb4", outline: "none" },
  waiting: { label: "等待中", color: "#9aa096", outline: "dashed" },
  withdrawn: { label: "已撤回", color: "#cbd0c7", outline: "solid" },
} as const satisfies Record<AnalyticsOutcome, { label: string; color: string; outline: string }>;

export const OUTCOMES = Object.keys(OUTCOME_STYLE) as AnalyticsOutcome[];
const responseOutcomes = new Set<AnalyticsOutcome>(["offer", "interview", "screening", "rejected"]);
const DAY = 86_400_000;
const nyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export const DIMENSIONS = {
  resume: "简历版本", lag: "投递时效", level: "职级", visa: "签证担保", role: "岗位方向", country: "国家",
} as const;
export type Dimension = keyof typeof DIMENSIONS;
export type LinkedFilter = { kind: "skill"; skill: string } | { kind: "group"; dimension: Dimension; key: string }
  | { kind: "application"; id: number };

export function responseCounts(items: readonly AnalyticsItem[]) {
  let replied = 0, mature = 0;
  for (const item of items) {
    if (responseOutcomes.has(item.outcome)) replied++;
    if (item.outcome !== "withdrawn" && item.outcome !== "waiting") mature++;
  }
  return { replied, mature };
}

export function kpis(items: readonly AnalyticsItem[]) {
  const { replied, mature } = responseCounts(items);
  const firstResponses = items.flatMap(item => item.firstResponseDays === null ? [] : [item.firstResponseDays]).sort((a, b) => a - b);
  const mid = Math.floor(firstResponses.length / 2);
  const medianResponse = !firstResponses.length ? null : firstResponses.length % 2 ? firstResponses[mid] : (firstResponses[mid - 1] + firstResponses[mid]) / 2;
  return {
    submitted: items.length, replied, mature, responseRate: mature ? replied / mature : null,
    waiting: items.filter(item => item.outcome === "waiting").length,
    withdrawn: items.filter(item => item.outcome === "withdrawn").length,
    interviewed: items.filter(item => item.outcome === "interview" || item.outcome === "offer").length,
    medianResponse,
  };
}

function monday(date: Date) {
  const parts = nyDate.formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === name)?.value);
  const day = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  return day.getTime() - (day.getUTCDay() + 6) % 7 * DAY;
}

export function timeRange(items: readonly AnalyticsItem[], range: "all" | "30" | "90", now: Date) {
  if (range === "all") return items;
  const cutoff = now.getTime() - Number(range) * DAY;
  return items.filter(item => Date.parse(item.appliedAt) >= cutoff && Date.parse(item.appliedAt) <= now.getTime());
}

export function weekly(items: readonly AnalyticsItem[], now = new Date()) {
  const last = monday(now);
  const weeks = Array.from({ length: 12 }, (_, index) => ({
    time: last - (11 - index) * 7 * DAY,
    items: [] as AnalyticsItem[],
  }));
  const start = weeks[0].time;
  for (const item of items) {
    const index = Math.floor((monday(new Date(item.appliedAt)) - start) / (7 * DAY));
    weeks[index]?.items.push(item);
  }
  return weeks.map(week => ({ week: new Date(week.time).toISOString().slice(0, 10), items: week.items, counts: outcomeCounts(week.items) }));
}

export function outcomeCounts(items: readonly AnalyticsItem[]) {
  const counts = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0])) as Record<AnalyticsOutcome, number>;
  for (const item of items) counts[item.outcome]++;
  return counts;
}

export function funnel(items: readonly AnalyticsItem[]) {
  const c = outcomeCounts(items);
  return [
    { label: "投递", amount: items.length, color: OUTCOME_STYLE.ghosted.color },
    { label: "有回复", amount: c.offer + c.interview + c.screening + c.rejected, color: OUTCOME_STYLE.screening.color },
    { label: "筛选及以上", amount: c.offer + c.interview + c.screening, color: OUTCOME_STYLE.screening.color },
    { label: "面试及以上", amount: c.offer + c.interview, color: OUTCOME_STYLE.interview.color },
    { label: "Offer", amount: c.offer, color: OUTCOME_STYLE.offer.color },
  ];
}

export function skillGaps(items: readonly AnalyticsItem[], limit = 15) {
  const groups = new Map<string, { skill: string; included: AnalyticsItem[]; missing: AnalyticsItem[] }>();
  for (const item of items) {
    for (const skill of item.jdSkills) {
      const group = groups.get(skill) ?? { skill, included: [], missing: [] };
      (item.matchedSkills.includes(skill) ? group.included : group.missing).push(item);
      groups.set(skill, group);
    }
  }
  return [...groups.values()].map(group => ({ ...group, total: group.included.length + group.missing.length }))
    .sort((a, b) => b.total - a.total || a.skill.localeCompare(b.skill)).slice(0, limit);
}

const lagLabels = ["0–3 天", "4–7 天", "8–14 天", ">14 天"];
const visaLabels = { available: "明确提供", unavailable: "明确不提供", unclear: "未确认" };
const countryLabels = { US: "美国", CN: "中国" };

function groupKeys(item: AnalyticsItem, dimension: Dimension): [key: string, label: string][] {
  switch (dimension) {
    case "resume": return item.resume ? [[`${item.resume.id}:${item.resume.version}`, `${item.resume.name} v${item.resume.version}`]] : [];
    case "lag": {
      const days = item.applyLagDays;
      if (days === null || days < 0) return [];
      const bucket = days < 4 ? 0 : days < 8 ? 1 : days < 15 ? 2 : 3;
      return [[String(bucket), lagLabels[bucket]]];
    }
    case "level": return item.careerLevel ? [[item.careerLevel, careerLevels[item.careerLevel]]] : [];
    case "visa": return item.visa ? [[item.visa, visaLabels[item.visa]]] : [];
    case "role": return item.categories.map(category => [category, jobCategories[category]]);
    case "country": return item.countries.map(country => [country, countryLabels[country]]);
  }
}

export function groupRows(items: readonly AnalyticsItem[], dimension: Dimension) {
  const groups = new Map<string, { key: string; label: string; items: AnalyticsItem[] }>();
  for (const item of items) {
    const labels = groupKeys(item, dimension);
    for (const [key, label] of labels.length ? labels : [["", dimension === "role" ? "未分类岗位" : "未知"]]) {
      const group = groups.get(key) ?? { key, label, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => Number(!a.key) - Number(!b.key)
    || (dimension === "lag" ? a.key.localeCompare(b.key) : b.items.length - a.items.length || a.label.localeCompare(b.label)))
    .map(group => ({
      ...group, ...responseCounts(group.items),
      items: group.items.sort((a, b) => OUTCOMES.indexOf(a.outcome) - OUTCOMES.indexOf(b.outcome)),
    }));
}

export function linkedItems(items: readonly AnalyticsItem[], filter: LinkedFilter) {
  switch (filter.kind) {
    case "skill": return items.filter(item => item.jdSkills.includes(filter.skill));
    case "application": return items.filter(item => item.id === filter.id);
    case "group": return groupRows(items, filter.dimension).find(group => group.key === filter.key)?.items ?? [];
  }
}
