import { dayWindow } from "./crawl-window";
import { AI_POLICY, careerLevels, jobCategories } from "./classification-types";
export const JOBS_PAGE_SIZE = 50;
export function jobQuery(url: URL, now = new Date()) {
  const raw = url.searchParams.get("page") ?? "1";
  const page = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Math.max(1, Number(raw)) : 1;
  const conditions = ["j.posted_at > ?1", `j.ai_policy='${AI_POLICY}' AND json_extract(j.ai_analysis,'$.accepted')=1`];
  const bindings: (string | number)[] = [new Date(now.getTime() - 7 * 86400000).toISOString()];
  const today = dayWindow(now);
  if (url.searchParams.get("period") === "today") {
    bindings.push(today.start, today.end);
    conditions.push(`j.publication_verified=1 AND j.posted_at >= ?${bindings.length - 1} AND j.posted_at < ?${bindings.length}`);
  }
  for (const [parameter, columns] of [["q", ["title", "company", "description"]], ["location", ["location"]], ["type", ["workplace_type", "employment_type"]]] as const) {
    let value = (url.searchParams.get(parameter) ?? "").trim().slice(0, 200);
    if (parameter === "type") value = value.toLowerCase().replace(/[-_\s]+/g, "");
    if (!value) continue;
    bindings.push(value);
    conditions.push(`(${columns.map(column => {
      const field = parameter === "type" ? `replace(replace(replace(lower(j.${column}),'-',''),'_',''),' ','')` : `j.${column}`;
      return `instr(lower(${field}),lower(?${bindings.length})) > 0`;
    }).join(" OR ")})`);
  }
  const category = url.searchParams.get("category"), level = url.searchParams.get("level");
  if (category) {
    bindings.push(category);
    conditions.push(Object.hasOwn(jobCategories, category) ? `EXISTS (SELECT 1 FROM json_each(j.ai_analysis,'$.categories') WHERE value=?${bindings.length})` : `(?${bindings.length} IS NULL AND 0=1)`);
  }
  if (level) {
    bindings.push(level);
    conditions.push(Object.hasOwn(careerLevels, level) ? `json_extract(j.ai_analysis,'$.careerLevel')=?${bindings.length}` : `(?${bindings.length} IS NULL AND 0=1)`);
  }
  return { page, pageSize: JOBS_PAGE_SIZE, where: conditions.join(" AND "), bindings, today };
}
export function pagination(total: number, requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE)), page = Math.min(requestedPage, totalPages);
  return { page, pageSize: JOBS_PAGE_SIZE, total, totalPages, offset: (page - 1) * JOBS_PAGE_SIZE };
}
