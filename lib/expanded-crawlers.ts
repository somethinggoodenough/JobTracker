import JSON5 from "json5";
import { clean, fetchJson, fetchSource, mapPool, stripHtml } from "./crawler-http";
import { jobPostingJson, publicDate, requireRows } from "./career-session";
import { createPostingSelection, isCrawlCandidate } from "./crawl-policy";
import type { JobRecord, SourceAdapter, SourceRecord } from "./job-types";

const chinaDate = (v: unknown) => publicDate(typeof v === "string" && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(v) && !/(Z|[+-]\d\d:\d\d)$/.test(v) ? v.replace(" ", "T") + "+08:00" : v);
const jd = (...parts: unknown[]) => {
  const text = stripHtml(parts.filter(Boolean).join("\n\n"));
  if (text.length < 30) throw new Error("公开职位缺少完整 JD，不能用岗位名称或摘要替代");
  return text;
};
const record = (source: SourceRecord, id: unknown, title: unknown, url: string, description: string, location = "未注明", postedAt: string | null = null): JobRecord => {
  if (!clean(id) || !clean(title)) throw new Error("公开职位缺少稳定编号或标题，来源结构可能已改变");
  return { externalId: clean(id), company: source.name, title: clean(title), canonicalUrl: url, applyUrl: url, description, location: location || "未注明", postedAt };
};

export async function pinpoint(source: SourceRecord): Promise<JobRecord[]> {
  const data = await fetchJson(new URL("/en/postings.json", source.url).href);
  const select = createPostingSelection();
  return requireRows(data.data, "Pinpoint").filter(() => select.accept(null)).map(j => ({
    ...record(source, j.id, j.title, new URL(j.url || j.path, source.url).href,
      jd(j.description, j.key_responsibilities, j.skills_knowledge_expertise, j.benefits),
      [j.location?.city, j.location?.province, j.location?.name].filter(Boolean).join(" · ") || "未注明"),
    department: clean(j.job?.department?.name), employmentType: clean(j.employment_type_text), workplaceType: clean(j.workplace_type_text),
  }));
}

// Netflix's legacy public search remains available while its PCSX endpoint is restricted.
export async function eightfoldLegacy(source: SourceRecord, account: string): Promise<JobRecord[]> {
  const select = createPostingSelection(), jobs: JobRecord[] = [];
  for (let start = 0; start < 1000;) {
    const url = new URL("/api/apply/v2/jobs", source.url);
    url.search = new URLSearchParams({ domain: account, start: String(start), sort_by: "new" }).toString();
    const data = await fetchJson(url.href), rows = requireRows(data.positions, "Eightfold legacy");
    const selected = rows.filter(() => select.accept(null));
    jobs.push(...(await mapPool<any, JobRecord | null>(selected, async row => {
      const url = new URL(`/careers/job/${row.id}`, source.url).href;
      const d = jobPostingJson(await (await fetchSource(url)).text());
      const date = publicDate(d.datePosted);
      if (!isCrawlCandidate(date)) return null;
      const locations = [d.jobLocation].flat().filter(Boolean).map((l: any) => [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry].filter(Boolean).join(", ")).join(" · ");
      return { ...record(source, row.id, d.title || row.name, url, jd(d.description), locations || (row.locations ?? []).join(" · "), date), employmentType: clean([d.employmentType].flat().join(" · ")) };
    })).filter((j): j is JobRecord => !!j));
    start += rows.length;
    if (!rows.length || start >= Number(data.count) || select.stop(rows.map(() => null))) return jobs;
  }
  throw new Error("Eightfold legacy 分页超过上限");
}

export async function shlab(source: SourceRecord): Promise<JobRecord[]> {
  const select = createPostingSelection(), jobs: JobRecord[] = [];
  const mode = source.url.includes("social") ? "social" : "campus";
  let token = "";
  for (let page = 0; page < 100; page++) {
    const url = new URL("/api/getJobList", source.url);
    url.search = new URLSearchParams({ mode, limit: "7", ...(token ? { page_token: token } : {}) }).toString();
    const data = await fetchJson(url.href);
    if (data.errno !== 0) throw new Error(`上海人工智能实验室接口错误：${clean(data.errmsg || data.errno)}`);
    const rows = requireRows(data.data?.items, "SHLAB");
    for (const j of rows) if (select.accept(null)) jobs.push({
      ...record(source, j.id, j.title, new URL(`/joinus/detail/${j.id}?mode=${mode}`, source.url).href,
        jd(j.description, j.requirement), [j.address?.country?.name?.zh_cn, j.address?.city?.name?.zh_cn].filter(Boolean).join(" · ")),
      employmentType: clean(j.job_recruitment_type?.name?.zh_cn), department: clean(j.job_department?.name),
    });
    if (!data.data.has_more || !rows.length || select.stop(rows.map(() => null))) return jobs;
    const next = clean(data.data.page_token);
    if (!next || next === token) throw new Error("SHLAB 翻页游标缺失或重复");
    token = next;
  }
  throw new Error("SHLAB 分页超过上限");
}

export async function beisenPb(source: SourceRecord): Promise<JobRecord[]> {
  const su = new URL(source.url).pathname.match(/\/(SU[a-z0-9]+)/i)?.[1];
  if (!su) throw new Error("北森 pb 入口缺少组织编号");
  const school = source.url.includes("school"), select = createPostingSelection(), jobs: JobRecord[] = [];
  let seen = 0;
  const request = async (action: string, body: Record<string, string>) => {
    const url = new URL(`/wecruit/positionInfo/${action}/${su}?iSaJAx=isAjax&request_locale=zh_CN`, source.url);
    const data = await fetchJson(url.href, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    if (String(data.state) !== "200") throw new Error(`北森 pb 接口错误：${clean(data.message || data.state)}`);
    return data.data;
  };
  for (let page = 1; page <= 200; page++) {
    const data = await request("listPosition", { isFrompb: "true", recruitType: school ? "1" : "2", pageSize: "50", currentPage: String(page) });
    const rows = requireRows(data.pageForm?.pageData, "北森 pb"), date = (j: any) => chinaDate(j.publishFirstDate);
    seen += rows.length;
    jobs.push(...await mapPool<any, JobRecord>(rows.filter(j => select.accept(date(j))), async j => {
      const d = await request("listPositionDetail", { postId: String(j.postId) });
      const url = new URL(`/${su}/pb/posDetail.html?postId=${j.postId}&postType=${school ? "school" : "society"}`, source.url).href;
      return record(source, j.postId, j.postName, url, jd(d.workContent, d.serviceCondition), clean(j.workPlaceStr) || "中国", date(j));
    }));
    // This list does not document posting-date ordering.
    if (!rows.length || seen >= Number(data.pageForm?.totalSize || data.positonNum) || (select.stop(rows.map(date)) && rows.every(j => !date(j)))) return jobs;
  }
  throw new Error("北森 pb 分页超过上限");
}

export async function kuaishouCampus(source: SourceRecord, account: string): Promise<JobRecord[]> {
  if (!account) throw new Error("快手校园招聘需要配置当前招聘项目编号");
  const select = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 1; page <= 200; page++) {
    const data = await fetchJson("https://campus.kuaishou.cn/recruit/campus/e/api/v1/open/positions/simple", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://campus.kuaishou.cn", referer: source.url },
      body: JSON.stringify({ pageNum: page, pageSize: 50, recruitSubProjectCodes: account.split(",") }),
    });
    if (data.code !== 0) throw new Error(`快手校园接口错误：${clean(data.message || data.code)}`);
    const rows = requireRows(data.result?.list, "快手校园"), date = (j: any) => chinaDate(j.releaseTime);
    for (const j of rows) if (select.accept(date(j))) jobs.push({
      ...record(source, j.id, j.name, `${new URL(source.url).origin}/recruit/campus/e/#/campus/job-info/${j.id}`,
        jd(j.description, j.positionDemand), (j.workLocationDicts ?? []).map((l: any) => l.name).join(" · ") || "中国", date(j)), employmentType: clean(j.positionNatureCode),
    });
    if (!rows.length || page >= Number(data.result.pages) || data.result.hasNextPage === false || (select.stop(rows.map(date)) && rows.every(j => !date(j)))) return jobs;
  }
  throw new Error("快手校园分页超过上限");
}

export async function huawei(source: SourceRecord): Promise<JobRecord[]> {
  const appId = "app_000000035886", base = "https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub";
  const request = async (action: string, body: unknown) => {
    const data = await fetchJson(`${base}/${action}?X-HW-ID=${appId}`, { method: "POST", headers: {
      "content-type": "application/json", "X-HW-ID": appId, "x-jalor-tenantAlias": "hcm", "x-language": "zh_CN", "x-Referer": "https://career.huawei.com/cn", "x-alb-gray": "prod", referer: source.url, origin: "https://career.huawei.com",
    }, body: JSON.stringify(body) });
    if (data.status !== "SUCCESS") throw new Error(`华为接口错误：${clean(data.message || data.status)}`);
    return data.data;
  };
  const select = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 1; page <= 200; page++) {
    const data = await request("getJobPage", { curPage: page, pageSize: 10, jobType: "CR", language: "zh_CN" });
    const rows = requireRows(data.result, "华为"), date = (j: any) => chinaDate(j.releaseDate);
    jobs.push(...await mapPool<any, JobRecord>(rows.filter(j => select.accept(date(j))), async j => {
      const intents = requireRows(await request("getPositionIntentionList", { jobId: j.jobId }), "华为岗位意向");
      const description = jd(...intents.map(d => [d.positionIntention, d.jobResponsibilities, d.jobDemand].filter(Boolean).join("\n")));
      return record(source, j.advertisementId, j.jobName, `https://career.huawei.com/cn/job-details?advertisementId=${j.advertisementId}`, description,
        clean(j.workPlace) || intents.map(d => clean(d.jobPlaceName)).filter(Boolean).join(" · ") || "未注明", date(j));
    }));
    if (!rows.length || page * 10 >= Number(data.pageVO?.totalRows) || (select.stop(rows.map(date)) && rows.every(j => !date(j)))) return jobs;
  }
  throw new Error("华为分页超过上限");
}

// Read a data literal only. JSON5 rejects calls/functions; remote code is never evaluated.
export function staticArray(script: string, marker: string): any[] {
  const at = script.indexOf(marker);
  if (at < 0) throw new Error("官网公开岗位数据结构改变");
  const start = script.indexOf("[", at + marker.length);
  let depth = 0, quote = "", escaped = false;
  for (let i = start; i >= 0 && i < script.length; i++) {
    const c = script[i];
    if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return requireRows(JSON5.parse(script.slice(start, i + 1)), "官网");
  }
  throw new Error("官网公开岗位数据不完整");
}

export async function luchentech(source: SourceRecord): Promise<JobRecord[]> {
  const html = await (await fetchSource(source.url)).text();
  const path = html.match(/src=["']([^"']*\/app\/join\/page-[^"']+\.js)["']/)?.[1];
  if (!path) throw new Error("潞晨官网岗位脚本入口已改变");
  const script = await (await fetchSource(new URL(path, source.url).href)).text();
  const marker = script.match(/(?:\b(?:var|let|const)\s+|[,;])\w+=(?=\[\{key:)/)?.[0];
  if (!marker) throw new Error("潞晨官网岗位数据入口已改变");
  const select = createPostingSelection();
  return staticArray(script, marker).filter(() => select.accept(null)).map(j => {
    const url = new URL(source.url); url.searchParams.set("role", String(j.key));
    return record(source, j.key, j.title, url.href, jd(...[j.responsibilities, j.requirements, j.bonus].map(section => section?.content?.join("\n")), "申请邮箱：resume@hpc-ai.com"));
  });
}

export function htmlDiv(html: string, start: number): string {
  if (start < 0) throw new Error("职位描述容器缺失");
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  for (let m; (m = tags.exec(html));) {
    if (m[0].startsWith("</")) { if (--depth === 0) return html.slice(start, tags.lastIndex); }
    else depth++;
  }
  throw new Error("职位描述 HTML 不完整");
}

export function lenovoListing(html: string) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rows = [...html.matchAll(/<article\b[^>]*class=["'][^"']*article--result\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)].map(m => {
    const link = m[1].match(/<a\b[^>]*href=["']([^"']*\/JobDetail\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) throw new Error("Lenovo 列表缺少职位详情链接");
    const date = m[1].match(/Posted\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    const month = date ? months.indexOf(date[2]) : -1;
    const subtitle = m[1].match(/class=["']article__header__text__subtitle["'][^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    return { url: link[1].replaceAll("&amp;", "&"), title: stripHtml(link[2]),
      location: stripHtml(subtitle.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1] || "") || "未注明",
      date: date && month >= 0 ? `${date[3]}-${String(month + 1).padStart(2, "0")}-${date[1].padStart(2, "0")}` : null };
  });
  if (!rows.length && !/No (?:jobs|results|positions)|0 jobs|0 results/i.test(stripHtml(html))) throw new Error("Lenovo 列表结构改变或访问受限");
  return rows;
}

export async function avature(source: SourceRecord): Promise<JobRecord[]> {
  const select = createPostingSelection(), jobs: JobRecord[] = [];
  let previous = "";
  for (let offset = 0; offset < 10000;) {
    const url = new URL(source.url);
    url.search = new URLSearchParams({ jobOffset: String(offset), jobRecordsPerPage: "10", jobSort: "schemaField_3_37_3", jobSortDirection: "DESC" }).toString();
    const rows = lenovoListing(await (await fetchSource(url.href)).text());
    const key = rows.map(r => r.url).join("|");
    if (key && key === previous) throw new Error("Lenovo 翻页返回重复页面");
    previous = key;
    jobs.push(...await mapPool(rows.filter(j => select.accept(j.date)), async j => {
      const url = new URL(j.url, source.url).href, html = await (await fetchSource(url)).text();
      const heading = html.indexOf("Description and Requirements");
      if (heading < 0) throw new Error("Lenovo 职位详情缺少职责要求部分");
      const start = html.indexOf('<div class="article__content__view__field__value"', heading);
      return record(source, new URL(url).pathname.split("/").filter(Boolean).at(-1), j.title, url, jd(htmlDiv(html, start)), j.location, j.date);
    }));
    // The official jobSort key is the posted-date field.
    if (!rows.length || rows.length < 10 || select.stop(rows.map(j => j.date))) return jobs;
    offset += rows.length;
  }
  throw new Error("Lenovo 分页超过上限");
}

export async function phenom(source: SourceRecord): Promise<JobRecord[]> {
  const select = createPostingSelection(), jobs: JobRecord[] = [];
  for (let from = 0; from < 20000;) {
    const payload = await fetchJson(new URL("/widgets", source.url).href, {
      method: "POST", headers: { "content-type": "application/json", referer: source.url },
      body: JSON.stringify({ lang: "en_global", deviceType: "desktop", country: "global", ddoKey: "refineSearch", from,
        jobs: true, counts: true, all_fields: ["category", "country", "state", "city", "type"], pageName: "search-results", size: 500,
        keywords: "", global: true, selected_fields: {}, locationData: {}, sortBy: "" }),
    });
    const data = payload.refineSearch;
    if (data?.status !== 200) throw new Error("Cisco Phenom 公开职位接口返回错误");
    const rows = requireRows(data.data?.jobs, "Phenom"), date = (j: any) => publicDate(j.postedDate);
    jobs.push(...await mapPool<any, JobRecord>(rows.filter(j => select.accept(date(j))), async j => {
      const url = new URL(`/global/en/job/${j.jobId || j.reqId}`, source.url).href;
      const html = await (await fetchSource(url)).text();
      const d = jobPostingJson(html);
      return { ...record(source, j.jobId || j.reqId, d.title || j.title, url, jd(d.description),
        (j.multi_location ?? []).join(" · ") || clean(j.location) || "未注明", publicDate(d.datePosted) || date(j)),
        applyUrl: clean(j.applyUrl) || url, employmentType: clean(j.type), department: clean(j.department || j.category), workplaceType: clean(j.RemoteType) };
    }));
    from += rows.length;
    // Phenom search is relevance ordered, so never stop at a page of old dates.
    if (!rows.length || from >= Number(data.totalHits) || (select.stop(rows.map(date)) && rows.every(j => !date(j)))) return jobs;
  }
  throw new Error("Cisco Phenom 分页超过上限");
}

export const expandedAdapters: Partial<Record<SourceAdapter, (s: SourceRecord, account: string) => Promise<JobRecord[]>>> = {
  pinpoint, eightfold_legacy: eightfoldLegacy, shlab, beisen_pb: beisenPb, kuaishou_campus: kuaishouCampus, huawei, luchentech, avature, phenom,
};
