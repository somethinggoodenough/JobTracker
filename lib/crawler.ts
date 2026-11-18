import type { CrawlBatch, JobRecord, SourceAdapter, SourceRecord } from "./job-types";
import { clean, fetchSource, stripHtml } from "./crawler-http";
import { companyProfile, dedicatedAdapters } from "./company-crawlers";
import { currentCrawlWindow, isOlderThanCrawlWindow, shiftCalendarDate, withCrawlWindow } from "./crawl-window";
import { hasPublicationDate, selectPostingRows } from "./crawl-policy";
import { createPostingSelection } from "./crawl-policy";
import { githubJobs, githubListingsUrl } from "./community-crawlers";
import { mapDetails } from "./detail-cache";

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
    if (host === "github.com" || host === "raw.githubusercontent.com" || host === "simplify.jobs") adapter = "github_jobs";
    else if (host.includes("greenhouse.io")) adapter = "greenhouse";
    else if (host.includes("lever.co")) adapter = "lever";
    else if (host.includes("ashbyhq.com")) adapter = "ashby";
    else if (host.includes("myworkdayjobs.com")) adapter = "workday";
    else if (host.includes("workable.com")) adapter = "workable";
    else if (host.endsWith(".jobs.feishu.cn") || host === "jobs.bytedance.com") adapter = "feishu";
    else if (host.endsWith(".zhiye.com")) adapter = "beisen";
    else if ((host === "app.mokahr.com" || host === "recruitment.metax-tech.com") && /^\/(?:(?:campus|social)-recruitment|apply)\//.test(parsed.pathname)) adapter = "moka";
    else if (host === "www.shlab.org.cn") adapter = "shlab";
    else if (host === "career.huawei.com") adapter = "huawei";
    else if (host === "campus.kuaishou.cn") adapter = "kuaishou_campus";
    else if (host === "hr.pcl.ac.cn" || host === "talents.zhejianglab.com") adapter = "beisen_pb";
    else if (host === "jobs.gem.com") adapter = "gem";
    else if (host === "lifeattiktok.com") adapter = "tiktok";
  }
  if (adapter === "github_jobs") fetchUrl = githubListingsUrl(parsed.href);
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
    description: stripHtml(job.content), postedAt: clean(job.first_published) || null,
  }));
}

async function greenhouseToday(fetchUrl: string, source: SourceRecord): Promise<CrawlBatch> {
  const url = new URL(fetchUrl); url.searchParams.set("content", "false");
  const listing = await (await fetchSource(url.toString())).json() as any;
  if (!Array.isArray(listing.jobs)) throw new Error("Greenhouse 返回结构已变更");
  const unknown = listing.jobs.filter((j:any) => !hasPublicationDate(j.first_published)).length;
  const metadata = unknown ? { warnings: [`${unknown} 条未提供发布日期，本轮仅取其中列表顺序前 50 条`] } : {};
  const selected = selectPostingRows<any>(listing.jobs, j => j.first_published);
  if (!selected.length) return Object.assign([], metadata);
  // Large daily batches are cheaper as one feed; small ones fetch only today's JDs.
  const jobs = await mapDetails<any, any>(selected, j => [j.id, j.updated_at, j.first_published], async j => {
      if (j.content) return j;
      const detail = new URL(url); detail.pathname += `/${encodeURIComponent(j.id)}`; detail.search = "";
      return { ...j, ...await (await fetchSource(detail.toString())).json() as any };
    }, 4, selected.length > 20 && !unknown ? async rows => {
      const full = ((await (await fetchSource(fetchUrl)).json()) as any).jobs;
      const byId = new Map(full.map((job: any) => [job.id, job]));
      return rows.map(row => {
        const job = byId.get(row.id);
        if (!job) throw new Error(`Greenhouse 职位在抓取时已变更：${row.id}`);
        return job;
      });
    } : undefined);
  return Object.assign(greenhouse({ jobs }, source), metadata);
}

function lever(data: any, source: SourceRecord): JobRecord[] {
  const rows = Array.isArray(data) ? data : [];
  const date = (j:any) => j.createdAt && Number.isFinite(new Date(j.createdAt).getTime()) ? new Date(j.createdAt).toISOString() : null;
  return selectPostingRows<any>(rows, date).map((job: any) => ({
    externalId: clean(job.id || job.hostedUrl), company: source.name || companyFromUrl(source.url),
    title: clean(job.text), canonicalUrl: clean(job.hostedUrl || job.applyUrl),
    applyUrl: clean(job.applyUrl || job.hostedUrl), location: clean(job.categories?.location) || "未注明",
    workplaceType: clean(job.workplaceType), employmentType: clean(job.categories?.commitment),
    department: clean(job.categories?.department || job.categories?.team),
    salary: job.salaryRange ? clean(`${job.salaryRange.currency ?? ""} ${job.salaryRange.min ?? ""}-${job.salaryRange.max ?? ""}`) : "",
    description: stripHtml(job.descriptionPlain || `${job.description ?? ""}\n${job.additional ?? ""}`),
    postedAt: date(job),
  }));
}

function ashby(data: any, source: SourceRecord): JobRecord[] {
  const rows = data?.jobs ?? [];
  return selectPostingRows<any>(rows, j => j.publishedAt).map((job: any) => ({
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

function relativePostedAt(value: unknown) {
  const raw = clean(value).toLowerCase();
  if (!raw) return null;
  if (/today|just posted|今天/.test(raw)) return currentCrawlWindow().date;
  if (/yesterday|昨天/.test(raw)) return shiftCalendarDate(currentCrawlWindow().date, -1);
  const match = raw.match(/(\d+)\+?\s*(day|天)/);
  if (match) return shiftCalendarDate(currentCrawlWindow().date, -Number(match[1]));
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function workday(source: SourceRecord): Promise<JobRecord[]> {
  const url = new URL(source.url);
  const tenant = url.hostname.split(".")[0];
  const parts = url.pathname.split("/").filter(Boolean);
  const localeOffset = parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/) ? 1 : 0;
  const site = parts[localeOffset] || parts[0];
  if (!tenant || !site) throw new Error("无法从 Workday URL 识别 tenant/site");
  const base = `${url.protocol}//${url.host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;
  const jobs: any[] = [];
  let truncated = false;
  for (let offset = 0; offset < 2000; offset += 20) {
    const response = await fetchSource(`${base}/jobs`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }) });
    const data = await response.json() as any;
    if (!Array.isArray(data.jobPostings)) throw new Error("Workday 返回结构已变更");
    jobs.push(...(data.jobPostings ?? []));
    if (jobs.length >= 50 && data.jobPostings.every((j:any) => !hasPublicationDate(relativePostedAt(j.postedOn)))) break;
    if (jobs.length >= Number(data.total ?? jobs.length) || !(data.jobPostings ?? []).length) break;
    if (data.jobPostings.every((j:any) => isOlderThanCrawlWindow(relativePostedAt(j.postedOn)))) break;
    if (offset === 1980) truncated = true;
  }
  const todayJobs = selectPostingRows<any>(jobs, job => relativePostedAt(job.postedOn));
  const results = await mapDetails<any, JobRecord>(todayJobs, job => [job.externalPath, job.updatedAt, job.title, job.locationsText, relativePostedAt(job.postedOn)], async job => {
        const detailResponse = await fetchSource(`${base}${job.externalPath}`);
        const detail = (await detailResponse.json() as any).jobPostingInfo ?? {};
        if (!detail.jobDescription || !detail.title) throw new Error(`Workday 职位详情缺失：${job.externalPath}`);
        const canonical = detail.externalUrl || `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}${job.externalPath}`;
        return {
          externalId: clean(detail.jobReqId || detail.jobPostingId || job.externalPath), company: source.name,
          title: clean(detail.title || job.title), canonicalUrl: canonical, applyUrl: canonical,
          location: clean(detail.location || job.locationsText) || "未注明", workplaceType: clean(detail.remoteType),
          employmentType: clean(detail.timeType), department: clean(detail.jobFamily), salary: clean(detail.compensation),
          description: stripHtml(detail.jobDescription), postedAt: clean(detail.startDate) || relativePostedAt(job.postedOn),
        } satisfies JobRecord;
  });
  return truncated ? Object.assign(results, { warnings: ["Workday 今日职位超过 2000 条，本次仅完成部分分页"] }) : results;
}

async function workable(source: SourceRecord): Promise<JobRecord[]> {
  const url = new URL(source.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const account = parts[0] === "api" ? parts[3] : parts[0];
  if (!account) throw new Error("无法从 Workable URL 识别 account");
  const endpoint = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(account)}/jobs`;
  const selected: any[] = [], selection = createPostingSelection(); let token: string | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await fetchSource(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }) });
    const data = await response.json() as any, rows = data.results ?? data.jobs;
    if (!Array.isArray(rows)) throw new Error("Workable 接口缺少职位列表，不能视为没有新职位");
    const published = (job: any) => clean(job.published || job.published_at) || null;
    selected.push(...rows.filter((job: any) => selection.accept(published(job))));
    if (!data.nextPage || !rows.length || selection.stop(rows.map(published))) break;
    if (data.nextPage === token) throw new Error("Workable 返回重复分页标记");
    token = data.nextPage;
    if (page === 99) throw new Error("Workable 分页超过上限");
  }
  return mapDetails<any, JobRecord>(selected, job => [job.shortcode, job.updated_at, job.published, job.title], async (job) => {
    const response = await fetchSource(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(account)}/jobs/${encodeURIComponent(job.shortcode)}`);
    const detail = await response.json() as any;
    if (!detail.description) throw new Error(`Workable 职位完整 JD 缺失：${job.shortcode}`);
    return {
    externalId: clean(job.shortcode || job.id || job.url), company: source.name, title: clean(job.title),
    canonicalUrl: clean(job.url || `https://apply.workable.com/${account}/j/${job.shortcode}/`),
    applyUrl: clean(job.url || `https://apply.workable.com/${account}/j/${job.shortcode}/`),
    location: (Array.isArray(job.locations) ? job.locations : [job.location]).map((location: any) => typeof location === "string" ? location : [location?.city, location?.region, location?.country].filter(Boolean).join(", ")).filter(Boolean).join(" · ") || "未注明",
    workplaceType: job.remote ? "Remote" : clean(job.workplace), employmentType: clean(job.employment_type || job.type),
    department: Array.isArray(job.department) ? job.department.join(" · ") : clean(job.department), salary: clean(job.salary), description: stripHtml([detail.description, detail.requirements, detail.benefits].filter(Boolean).join("\n\n")),
    postedAt: clean(job.published || job.published_at) || null,
  }; });
}

function flattenJsonLd(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  return [value, ...flattenJsonLd(value["@graph"] ?? []), ...flattenJsonLd(value.itemListElement ?? []), ...flattenJsonLd(value.item ?? [])];
}

function jsonLd(html: string, source: SourceRecord): JobRecord[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const nodes = blocks.flatMap((match) => { try { return flattenJsonLd(JSON.parse(match[1])); } catch { return []; } });
  return nodes.filter((node) => node["@type"] === "JobPosting" || (Array.isArray(node["@type"]) && node["@type"].includes("JobPosting"))).map((job) => {
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

function discoverAtsUrl(html: string, baseUrl: string) {
  const decoded = html.replace(/&amp;/g, "&").replace(/\\u002F/g, "/");
  const urls = [...decoded.matchAll(/https?:\\?\/\\?\/[a-z0-9._-]+(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com)[^"'<>\s\\]*/gi)]
    .map((match) => match[0].replace(/\\\//g, "/"));
  if (urls.length) return urls[0];
  for (const match of decoded.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const candidate = new URL(match[1], baseUrl).toString();
      if (/(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com)/i.test(candidate)) return candidate;
    } catch {}
  }
  return null;
}

async function genericPage(source: SourceRecord): Promise<JobRecord[]> {
  const response = await fetchSource(source.url);
  const finalUrl = response.url || source.url;
  const html = await response.text();
  const direct = jsonLd(html, source);
  if (direct.length) return direct;
  const atsUrl = discoverAtsUrl(html, finalUrl);
  if (atsUrl && atsUrl !== source.url) return crawlSource({ ...source, url: atsUrl, adapter: "auto" });
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const candidate = new URL(match[1], finalUrl);
      if (/job|career|position|opening|vacanc/i.test(candidate.pathname + candidate.search)) links.add(candidate.toString());
    } catch {}
    if (links.size >= 50) break;
  }
  const results: JobRecord[] = [];
  const values = [...links];
  for (let i = 0; i < values.length; i += 6) {
    const batch = await Promise.all(values.slice(i, i + 6).map(async (url) => {
      try { const page = await fetchSource(url); return jsonLd(await page.text(), { ...source, url }); } catch { return []; }
    }));
    results.push(...batch.flat());
  }
  if (!results.length) throw new Error("页面可访问，但未发现受支持的 ATS、JobPosting JSON-LD 或职位详情链接");
  return results;
}

async function crawlRaw(source: SourceRecord): Promise<CrawlBatch> {
  const profile = companyProfile(source);
  if (profile && "unavailableReason" in profile && profile.unavailableReason) throw new Error(profile.unavailableReason);
  if (profile) source = { ...source, url: profile.url, adapter: profile.adapter as SourceAdapter };
  const dedicated = dedicatedAdapters[source.adapter];
  if (dedicated) return dedicated(source, profile && "account" in profile ? profile.account ?? "" : "");
  const normalized = normalizeSource(source.url, source.adapter);
  if (normalized.adapter === "github_jobs") return githubJobs(source);
  const normalizedDedicated = dedicatedAdapters[normalized.adapter];
  if (normalizedDedicated) return normalizedDedicated({ ...source, adapter: normalized.adapter }, "");
  if (normalized.adapter === "auto") return genericPage(source);
  if (normalized.adapter === "workday") return workday(source);
  if (normalized.adapter === "workable") return workable(source);
  if (normalized.adapter === "greenhouse") return greenhouseToday(normalized.fetchUrl, source);
  const response = await fetchSource(normalized.fetchUrl);
  if (normalized.adapter === "jsonld") return jsonLd(await response.text(), source);
  const data = await response.json();
  if (normalized.adapter === "ashby" && !Array.isArray((data as any)?.jobs)) throw new Error("Ashby 返回结构已变更");
  if (normalized.adapter === "lever" && !Array.isArray(data)) throw new Error("Lever 返回结构已变更");
  if (normalized.adapter === "lever") return lever(data, source);
  if (normalized.adapter === "ashby") return ashby(data, source);
  return [];
}

export async function crawlSource(source: SourceRecord): Promise<CrawlBatch> {
  return withCrawlWindow(currentCrawlWindow(), async () => {
  const jobs = await crawlRaw(source);
  const unknown = jobs.filter(j => !hasPublicationDate(j.postedAt)).length;
  const warnings = [...(jobs.warnings ?? [])];
  if (unknown) warnings.push(`发布日期未知：本轮最多取前 50 条；通过筛选后按首次发现时间保留 7 天，不计入今日发布`);
  return Object.assign(selectPostingRows(jobs, j => j.postedAt).map(job => hasPublicationDate(job.postedAt) ? job : { ...job, postedAt: null }), warnings.length ? { warnings } : {});
  });
}
