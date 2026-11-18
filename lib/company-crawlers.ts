import profiles from "@/data/company-adapters.json";
import { additionalAdapters } from "./additional-crawlers";
import { expandedAdapters } from "./expanded-crawlers";
import { throwIfSyncCancelled } from "./sync-control";
import type { JobRecord, SourceAdapter, SourceRecord } from "./job-types";
import { clean, fetchJson, fetchSource, mapPool, recent, stripHtml } from "./crawler-http";
import { mapDetails } from "./detail-cache";
import { isOlderThanCrawlWindow } from "./crawl-window";
import { createPostingSelection, isCrawlCandidate, selectPostingRows } from "./crawl-policy";

export function companyProfile(source: Pick<SourceRecord, "name">) {
  return profiles.find((item) => item.name === source.name);
}

const iso = (value: unknown) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const n = typeof value === "number" ? value * (value < 1e12 ? 1000 : 1) : Date.parse(String(value));
  if (typeof value === "string" && /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(value) && Number.isFinite(n)) return new Date(n).toISOString().slice(0,10);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};

export async function amazon(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  for (let offset = 0; offset < 10000; offset += 100) {
    const data = await fetchJson(`https://www.amazon.jobs/en/search.json?offset=${offset}&result_limit=100&sort=recent`);
    if (data.error) throw new Error(JSON.stringify(data.error));
    const page = data.jobs;
    if (!Array.isArray(page)) throw new Error("Amazon 返回结构已变更：缺少 jobs");
    for (const j of page) {
      const date = iso(j.posted_date);
      if (!selection.accept(date)) continue;
      const url = new URL(j.job_path, "https://www.amazon.jobs").toString();
      jobs.push({ externalId: clean(j.id_icims || j.id), company: source.name, title: clean(j.title),
        canonicalUrl: url, applyUrl: j.url_next_step || url, location: clean(j.normalized_location || j.location),
        department: clean(j.business_category === "aws" ? "AWS" : j.job_category), employmentType: clean(j.job_schedule_type),
        description: stripHtml([j.description, "Basic qualifications", j.basic_qualifications, "Preferred qualifications", j.preferred_qualifications].join("\n")), postedAt: date });
    }
    if (!page.length || offset + page.length >= Number(data.hits) || selection.stop(page.map((j:any) => iso(j.posted_date)))) break;
    if (offset === 9900) throw new Error("Amazon 最近职位超过 10,000 条分页上限，需要缩小查询范围");
  }
  return jobs;
}

// Google's public server-rendered data is JSON; do not execute remote JavaScript.
export function parseGoogle(html: string, source: SourceRecord): { jobs: JobRecord[]; total: number } {
  const block = html.match(/AF_initDataCallback\(\{key: 'ds:1',[\s\S]*?data:([\s\S]*?), sideChannel:/);
  if (!block) throw new Error("Google 页面数据结构已变更，未找到公开职位数据");
  const data = JSON.parse(block[1]);
  if (!Array.isArray(data[0])) return { jobs: [], total: Number(data[2] || 0) };
  return { total: Number(data[2] || 0), jobs: data[0].map((j: any[]) => {
    if (!j[0] || !j[1]) throw new Error("Google 职位字段结构已变更");
    const url = `https://www.google.com/about/careers/applications/jobs/results/${j[0]}`;
    return { externalId: clean(j[0]), company: clean(j[7]) || source.name, title: clean(j[1]), canonicalUrl: url,
      applyUrl: url, location: (j[9] ?? []).map((l: any[]) => l[0]).filter(Boolean).join(" · ") || "未注明",
      description: stripHtml([j[10]?.[1], j[4]?.[1], j[3]?.[1]].filter(Boolean).join("\n")),
      postedAt: iso(j[12]?.[0]) };
  }) };
}

export async function google(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  for (let page = 1; page <= 250; page++) {
    const url = new URL(source.url); url.searchParams.set("sort_by", "date"); url.searchParams.set("page", String(page));
    const parsed = parseGoogle(await (await fetchSource(url.toString())).text(), source);
    jobs.push(...parsed.jobs.filter(j => selection.accept(j.postedAt)));
    if (!parsed.jobs.length || page * 20 >= parsed.total || selection.stop(parsed.jobs.map(j => j.postedAt))) return jobs;
  }
  throw new Error("Google 分页超过 250 页，请缩小查询范围");
}

export async function jibe(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  for (let page = 1; page <= 200; page++) {
    const url = new URL("/api/jobs", source.url); url.searchParams.set("page", String(page)); url.searchParams.set("sortBy", "posted_date"); url.searchParams.set("descending", "true");
    const data = await fetchJson(url.toString());
    if (!Array.isArray(data.jobs)) throw new Error("Jibe 返回结构已变更");
    const rows = data.jobs.map((row: any) => row.data);
    for (const j of rows) if (selection.accept(iso(j.posted_date))) jobs.push({
      externalId: clean(j.req_id || j.slug), company: source.name, title: clean(j.title),
      canonicalUrl: j.meta_data?.canonical_url || new URL(`/jobs/${j.slug}`, source.url).toString(),
      applyUrl: j.apply_url, location: clean(j.full_location || j.location_name), employmentType: clean(j.employment_type),
      department: clean(j.department || j.categories?.map((c: any) => c.name).join(" · ")),
      salary: [...(j.tags2 ?? []), ...(j.tags3 ?? [])].join(" - "),
      description: stripHtml([j.description, j.responsibilities, j.qualifications].filter(Boolean).join("\n")), postedAt: iso(j.posted_date) });
    if (!rows.length || page * rows.length >= Number(data.totalCount) || selection.stop(rows.map((j:any) => iso(j.posted_date)))) return jobs;
  }
  throw new Error("Jibe 分页超过上限");
}

export async function tencent(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  for (let page = 1; page <= 200; page++) {
    const data = await fetchJson(`https://careers.tencent.com/tencentcareer/api/post/Query?pageIndex=${page}&pageSize=100&language=zh-cn&area=cn`);
    if (data.Code !== 200 || !Array.isArray(data.Data?.Posts)) throw new Error("腾讯接口错误：" + clean(data.Message || data.Code));
    const rows = data.Data.Posts;
    const published = (j:any) => iso(j.PublishTime || j.PostDate || j.FirstPublishTime);
    const selected = rows.filter((j: any) => selection.accept(published(j)));
    const parsed = await mapDetails<any, JobRecord>(selected, j => [j.PostId, null, published(j), j.RecruitPostName, j.LocationName], async j => {
      const detail = await fetchJson(`https://careers.tencent.com/tencentcareer/api/post/ByPostId?postId=${j.PostId}&language=zh-cn`);
      if (detail.Code !== 200 || !detail.Data) throw new Error(`腾讯职位详情失败：${j.PostId}`);
      const d = detail.Data;
      const url = `https://careers.tencent.com/jobdesc.html?postId=${j.PostId}`;
      return { externalId: clean(j.PostId), company: source.name, title: clean(j.RecruitPostName), canonicalUrl: url, applyUrl: url,
        location: clean(j.LocationName), department: [j.BGName, j.ProductName, j.CategoryName].filter(Boolean).join(" · "),
        description: stripHtml([d.Responsibility || j.Responsibility, d.Requirement, j.RequireWorkYearsName].filter(Boolean).join("\n\n")),
        postedAt: published(j) };
    });
    jobs.push(...parsed);
    if (!rows.length || page * 100 >= Number(data.Data.Count) || (selection.stop(rows.map(published)) && rows.every((j:any) => !published(j)))) return jobs;
    // Do not stop on an old page: Tencent does not guarantee posting-date order.
  }
  throw new Error("腾讯职位分页超过上限");
}

export async function eightfold(source: SourceRecord, account: string): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  try {
  for (let start = 0; start < 10000;) {
    const url = new URL("/api/pcsx/search", source.url);
    url.search = new URLSearchParams({ domain: account, start: String(start), num: "50", sort_by: "timestamp" }).toString();
    const data = await fetchJson(url.toString());
    if (!Array.isArray(data.data?.positions)) throw new Error("Eightfold 返回结构已变更");
    const rows = data.data.positions;
    const priorCount = jobs.length;
    const parsed = await mapDetails<any, JobRecord>(rows.filter((j: any) => selection.accept(iso(j.postedTs))),
      j => [j.id, j.updatedTs, j.postedTs, j.name, j.locations], async j => {
      const detailUrl = new URL("/api/pcsx/position_details", source.url);
      detailUrl.search = new URLSearchParams({ position_id: String(j.id), domain: account }).toString();
      const d = (await fetchJson(detailUrl.toString())).data;
      if (!d?.jobDescription) throw new Error(`Eightfold 职位详情缺失：${j.id}`);
      const url = new URL(d.publicUrl || j.positionUrl, source.url).toString();
      const job = { externalId: clean(d.atsJobId || j.id), company: source.name, title: clean(d.name), canonicalUrl: url, applyUrl: url,
        location: clean(d.locations?.join(" · ") || d.location), department: clean(d.department), workplaceType: clean(d.workLocationOption),
        description: stripHtml(d.jobDescription), postedAt: iso(d.postedTs) };
      jobs.push(job);
      return job;
    }, 1);
    jobs.splice(priorCount, jobs.length - priorCount, ...parsed);
    if (!rows.length || start + rows.length >= Number(data.data.count) || selection.stop(rows.map((j:any) => iso(j.postedTs)))) return jobs;
    start += rows.length;
  }
  throw new Error("Eightfold 分页超过上限");
  } catch (error) {
    if (!jobs.length) throw error;
    return Object.assign(jobs, { warnings: [`仅完成部分抓取（${jobs.length} 条）：${error instanceof Error ? error.message : error}`] });
  }
}

export async function oracle(source: SourceRecord, origin: string): Promise<JobRecord[]> {
  const base = `${origin}/hcmRestApi/resources/latest`;
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  for (let offset = 0; offset < 10000; offset += 100) {
    const url = new URL(`${base}/recruitingCEJobRequisitions`);
    const profile = companyProfile(source);
    const site = profile && "site" in profile ? String(profile.site) : source.name === "Dell" ? "CX_1001" : "CX_1";
    url.search = new URLSearchParams({ onlyData: "true", expand: "requisitionList", finder: `findReqs;siteNumber=${site},limit=100,offset=${offset},sortBy=POSTING_DATES_DESC` }).toString();
    const data = (await fetchJson(url.toString())).items?.[0];
    if (!Array.isArray(data?.requisitionList)) throw new Error("Oracle 返回结构已变更");
    jobs.push(...await mapDetails<any, JobRecord>(data.requisitionList.filter((j: any) => selection.accept(iso(j.PostedDate))),
      j => [j.Id, j.LastUpdateDate, j.PostedDate, j.Title, j.PrimaryLocation], async j => {
      const url = new URL(`${base}/recruitingCEJobRequisitionDetails`);
      url.search = new URLSearchParams({ onlyData: "true", finder: `ById;Id=${j.Id}` }).toString();
      const d = (await fetchJson(url.toString())).items?.[0];
      if (!d?.ExternalDescriptionStr) throw new Error(`Oracle 职位详情缺失：${j.Id}`);
      const board = new URL(source.url);
      board.pathname = board.pathname.replace(/\/sites\/([^/]+).*$/, `/sites/$1/job/${j.Id}`);
      board.search = ""; board.hash = "";
      const canonical = board.href;
      return { externalId: clean(j.Id), company: source.name, title: clean(d.Title), canonicalUrl: canonical, applyUrl: canonical,
        location: clean(d.PrimaryLocation), employmentType: clean(d.JobSchedule), department: clean(d.Category || d.JobFunction),
        workplaceType: clean(d.WorkplaceType), description: stripHtml([d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].filter(Boolean).join("\n")), postedAt: iso(d.ExternalPostedStartDate) };
    }));
    if (!data.requisitionList.length || offset + data.requisitionList.length >= Number(data.TotalJobsCount) || selection.stop(data.requisitionList.map((j:any) => iso(j.PostedDate)))) return jobs;
  }
  throw new Error("Oracle 分页超过上限");
}

export async function smartrecruiters(source: SourceRecord, account: string): Promise<JobRecord[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(account)}/postings`;
  const jobs: JobRecord[] = [];
  const selection = createPostingSelection();
  for (let offset = 0; offset < 10000; offset += 100) {
    const data = await fetchJson(`${base}?limit=100&offset=${offset}`);
    if (!Array.isArray(data.content)) throw new Error("SmartRecruiters 返回结构已变更");
    jobs.push(...await mapDetails<any, JobRecord>(data.content.filter((j: any) => selection.accept(iso(j.releasedDate))),
      j => [j.id, j.updatedOn, j.releasedDate, j.name, j.location], async j => {
      const d = await fetchJson(`${base}/${j.id}`);
      const url = d.postingUrl || `https://jobs.smartrecruiters.com/${account}/${j.id}`;
      const sections = Object.values(d.jobAd?.sections ?? {}) as any[];
      return { externalId: clean(j.id), company: source.name, title: clean(d.name), canonicalUrl: url, applyUrl: d.applyUrl || url,
        location: clean(d.location?.fullLocation || [d.location?.city, d.location?.country].filter(Boolean).join(", ")),
        department: clean(d.department?.label), employmentType: clean(d.typeOfEmployment?.label),
        workplaceType: d.location?.remote ? "Remote" : d.location?.hybrid ? "Hybrid" : "OnSite",
        description: stripHtml(sections.map(s => `${s.title ?? ""}\n${s.text ?? ""}`).join("\n")), postedAt: iso(d.releasedDate) };
    }));
    if (!data.content.length || offset + data.content.length >= Number(data.totalFound) || selection.stop(data.content.map((j:any) => iso(j.releasedDate)))) return jobs;
  }
  throw new Error("SmartRecruiters 分页超过上限");
}

export function parseApple(html: string): any {
  const block = html.match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/);
  if (!block) throw new Error("Apple 页面结构已变更，缺少公开职位数据");
  return JSON.parse(JSON.parse(block[1])).loaderData;
}

export async function apple(source: SourceRecord): Promise<JobRecord[]> {
  const results: JobRecord[] = [];
  const selection = createPostingSelection();
  const warnings: string[] = []; let validPages = 0;
  for (const country of ["united-states-USA", "china-mainland-CHN"]) { try {
  for (let page = 1; page <= 400; page++) {
    const data = parseApple(await (await fetchSource(`https://jobs.apple.com/en-us/search?location=${country}&sort=newest&page=${page}`)).text()).search;
    if (!Array.isArray(data?.searchResults)) throw new Error("Apple 搜索结果字段已变更");
    validPages++;
    const rows = data.searchResults;
    const errors: string[] = [];
    const jobs = await mapPool<any, JobRecord | null>(rows.filter((j: any) => selection.accept(iso(j.postDateInGMT || j.postingDate))), async j => { try {
      const url = `https://jobs.apple.com/en-us/details/${encodeURIComponent(j.positionId)}/${encodeURIComponent(j.transformedPostingTitle)}`;
      const d = parseApple(await (await fetchSource(url)).text()).jobDetails?.jobsData;
      if (!d?.description) throw new Error(`Apple 职位详情缺失：${j.positionId}`);
      // Evergreen retail roles expose a request-time timestamp; prefer the actual location posting date.
      const dates = Object.values(d.postingPostLocationData?.en_US ?? {}).map((v: any) => v.postingDate).filter(Boolean).sort();
      const date = iso(dates[0] || d.postDateInGMT || j.postingDate);
      if (!isCrawlCandidate(date)) return null;
      return { externalId: clean(d.reqId || j.id), company: source.name, title: clean(d.postingTitle), canonicalUrl: url, applyUrl: url,
        location: d.locations?.map((l: any) => [l.name, l.stateProvince, l.countryName].filter(Boolean).join(", ")).join(" · ") || "未注明", department: d.teamNames?.join(" · "),
        workplaceType: d.homeOffice ? "Remote" : "OnSite", description: stripHtml([d.jobSummary, d.description, d.minimumQualifications, d.preferredQualifications, d.payAndBenefits].filter(Boolean).join("\n\n")), postedAt: date };
    } catch (error) { throwIfSyncCancelled(); errors.push(error instanceof Error ? error.message : "Apple 详情失败"); return null; } });
    results.push(...jobs.filter((j): j is JobRecord => j !== null));
    if (errors.length) { warnings.push(`${country} 部分详情未完成（${errors.length} 条）：${errors[0]}`); break; }
    if (!rows.length || page * rows.length >= data.totalRecords || selection.stop(rows.map((j:any) => iso(j.postDateInGMT || j.postingDate)))) break;
    if (page === 400) warnings.push(`${country} 超过 400 页，本次部分完成`);
  }
  } catch (error) { throwIfSyncCancelled(); warnings.push(`${country}：${error instanceof Error ? error.message : "读取失败"}`); } }
  if (!validPages || !results.length && warnings.length) throw new Error(warnings.join("；"));
  return warnings.length ? Object.assign(results, { warnings }) : results;
}

export async function paycor(source: SourceRecord): Promise<JobRecord[]> {
  const html = await (await fetchSource(source.url)).text();
  const block = html.match(/window\.__AYAR_CAREER_JOBS__\s*=\s*(\[[\s\S]*?\]);/);
  if (!block) throw new Error("Ayar Labs 公开职位数据结构已变更");
  return selectPostingRows<any>(JSON.parse(block[1]), j => iso(j.datePosted)).map((j: any) => ({ externalId: clean(j.id), company: source.name,
    title: clean(j.title), canonicalUrl: clean(j.url), applyUrl: clean(j.url),
    location: [j.city, j.state, j.country].filter(Boolean).join(", "), department: clean(j.department),
    employmentType: clean(j.employmentType), description: stripHtml(j.summary), postedAt: iso(j.datePosted) }));
}

export async function comeet(source: SourceRecord): Promise<JobRecord[]> {
  const html = await (await fetchSource(source.url)).text();
  const endpoint = html.match(/(?:CAREER_API_URL|careerApiUrl)\s*=\s*['"]([^'"]+)['"]/)?.[1];
  if (!endpoint) throw new Error("VAST Data 官网未公布 Comeet 职位地址");
  const url = new URL(endpoint);
  if (!/^www\.comeet\.co$/.test(url.host) || !url.pathname.startsWith("/careers-api/")) throw new Error("Comeet 地址不在已验证的招聘域名");
  const jobs = await fetchJson(url.toString());
  if (!Array.isArray(jobs)) throw new Error("Comeet 返回结构已变更");
  const selected = selectPostingRows<any>(jobs.filter(j => !j.is_internal), j => iso(j.time_published || j.date_posted));
  return mapPool<any,JobRecord>(selected, async j => {
    let d = j;
    if (!j.details?.length) { const detailUrl = new URL(url); detailUrl.pathname += `/${encodeURIComponent(j.uid)}`; d = await fetchJson(detailUrl.toString()); }
    const location = d.location || j.location || {};
    const canonical = d.url_active_page || d.url_comeet_hosted_page || j.url_active_page || j.url_comeet_hosted_page || source.url;
    return { externalId: clean(d.uid || j.uid), company: source.name, title: clean(d.name || j.name), canonicalUrl: canonical, applyUrl: canonical,
      location: typeof location === "string" ? location : [location.city,location.state,location.country].filter(Boolean).join(", ") || "未注明",
      employmentType: clean(d.employment_type || j.employment_type), department: clean(d.department || j.department),
      description: stripHtml((d.details || []).map((s:any) => `${s.name || ""}\n${s.value || ""}`).join("\n\n")), postedAt: iso(d.time_published || d.date_posted || j.time_published || j.date_posted) };
  });
}

export const dedicatedAdapters: Partial<Record<SourceAdapter, (source: SourceRecord, account: string) => Promise<JobRecord[]>>> = {
  ...expandedAdapters,
  ...additionalAdapters,
  amazon, google, jibe, tencent, eightfold, oracle, smartrecruiters, apple, paycor, comeet,
};
