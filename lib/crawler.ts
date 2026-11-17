import type { JobRecord, SourceAdapter, SourceRecord } from "./job-types";

const USER_AGENT = "JobRadar/1.0 (+hourly job aggregation; respects source terms)";
const clean = (value: unknown) => value == null ? "" : String(value).trim();

function stripHtml(value: unknown): string {
  return clean(value)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 40_000);
}

function companyFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname.split(".")[0];
    return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch { return "未知公司"; }
}

export function normalizeSource(input: string, requested: SourceAdapter = "auto") {
  const parsed = new URL(input.trim());
  parsed.hash = "";
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  let adapter = requested;
  let fetchUrl = parsed.toString();
  if (adapter === "auto") {
    if (host.includes("greenhouse.io")) adapter = "greenhouse";
    else if (host.includes("lever.co")) adapter = "lever";
    else if (host.includes("ashbyhq.com")) adapter = "ashby";
    else adapter = "jsonld";
  }
  if (adapter === "greenhouse" && !host.startsWith("boards-api.")) {
    const token = parts[0] === "embed" ? parsed.searchParams.get("for") : parts[0];
    if (token) fetchUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  }
  if (adapter === "lever" && !host.startsWith("api.")) {
    if (parts[0]) fetchUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}?mode=json`;
  }
  if (adapter === "ashby" && !host.startsWith("api.")) {
    if (parts[0]) fetchUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parts[0])}`;
  }
  return { adapter, fetchUrl, canonicalInput: parsed.toString() };
}

async function fetchSource(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json,text/html;q=0.9" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally { clearTimeout(timer); }
}

function greenhouse(data: any, source: SourceRecord): JobRecord[] {
  const company = clean(data?.name) || source.name || companyFromUrl(source.url);
  return (data?.jobs ?? []).map((job: any) => ({
    externalId: clean(job.id || job.absolute_url), company, title: clean(job.title),
    canonicalUrl: clean(job.absolute_url), applyUrl: clean(job.absolute_url),
    location: clean(job.location?.name) || "未注明",
    workplaceType: /remote|远程/i.test(clean(job.location?.name)) ? "Remote" : null,
    employmentType: clean(job.metadata?.find?.((x: any) => /employment|type/i.test(x?.name))?.value),
    department: clean(job.departments?.map((x: any) => x.name).filter(Boolean).join(" · ")),
    salary: clean(job.pay_input_ranges?.map((x: any) => x.title).filter(Boolean).join(" · ")),
    description: stripHtml(job.content), postedAt: clean(job.updated_at) || null,
  }));
}

function lever(data: any, source: SourceRecord): JobRecord[] {
  return (Array.isArray(data) ? data : []).map((job: any) => ({
    externalId: clean(job.id || job.hostedUrl), company: source.name || companyFromUrl(source.url),
    title: clean(job.text), canonicalUrl: clean(job.hostedUrl || job.applyUrl),
    applyUrl: clean(job.applyUrl || job.hostedUrl), location: clean(job.categories?.location) || "未注明",
    workplaceType: clean(job.workplaceType), employmentType: clean(job.categories?.commitment),
    department: clean(job.categories?.department || job.categories?.team),
    salary: job.salaryRange ? clean(`${job.salaryRange.currency ?? ""} ${job.salaryRange.min ?? ""}-${job.salaryRange.max ?? ""}`) : "",
    description: stripHtml(job.descriptionPlain || `${job.description ?? ""}\n${job.additional ?? ""}`),
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
  }));
}

function ashby(data: any, source: SourceRecord): JobRecord[] {
  return (data?.jobs ?? []).map((job: any) => ({
    externalId: clean(job.id || job.jobUrl), company: source.name || companyFromUrl(source.url),
    title: clean(job.title), canonicalUrl: clean(job.jobUrl || job.applyUrl),
    applyUrl: clean(job.applyUrl || job.jobUrl),
    location: clean(job.location || job.secondaryLocations?.map((x: any) => x.location).join(" · ")) || "未注明",
    workplaceType: clean(job.workplaceType) || (job.isRemote ? "Remote" : ""),
    employmentType: clean(job.employmentType), department: clean(job.department || job.team),
    salary: clean(job.compensationTierSummary), description: stripHtml(job.descriptionPlain || job.descriptionHtml),
    postedAt: clean(job.publishedAt) || null,
  }));
}

function flattenJsonLd(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  return [value, ...flattenJsonLd(value["@graph"] ?? [])];
}

function jsonLd(html: string, source: SourceRecord): JobRecord[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const nodes = blocks.flatMap((match) => { try { return flattenJsonLd(JSON.parse(match[1])); } catch { return []; } });
  return nodes.filter((node) => node["@type"] === "JobPosting").map((job) => {
    const address = job.jobLocation?.address ?? job.jobLocation?.[0]?.address;
    const location = typeof address === "string" ? address :
      [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(", ");
    const salary = job.baseSalary?.value;
    return {
      externalId: clean(job.identifier?.value || job.identifier || job.url || job.title),
      company: clean(job.hiringOrganization?.name) || source.name || companyFromUrl(source.url),
      title: clean(job.title), canonicalUrl: clean(job.url || source.url), applyUrl: clean(job.url || source.url),
      location: clean(location || job.jobLocationType) || "未注明", workplaceType: clean(job.jobLocationType),
      employmentType: Array.isArray(job.employmentType) ? job.employmentType.join(" · ") : clean(job.employmentType),
      department: clean(job.industry || job.occupationalCategory),
      salary: salary ? clean(`${salary.minValue ?? ""}-${salary.maxValue ?? ""} ${job.baseSalary?.currency ?? ""} / ${salary.unitText ?? ""}`) : "",
      description: stripHtml(job.description), postedAt: clean(job.datePosted) || null,
    };
  });
}

export async function crawlSource(source: SourceRecord): Promise<JobRecord[]> {
  const normalized = normalizeSource(source.url, source.adapter);
  const response = await fetchSource(normalized.fetchUrl);
  if (normalized.adapter === "jsonld") return jsonLd(await response.text(), source);
  const data = await response.json();
  if (normalized.adapter === "greenhouse") return greenhouse(data, source);
  if (normalized.adapter === "lever") return lever(data, source);
  if (normalized.adapter === "ashby") return ashby(data, source);
  return [];
}
