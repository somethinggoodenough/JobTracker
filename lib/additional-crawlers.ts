import type { JobRecord, SourceAdapter, SourceRecord } from "./job-types";
import { clean, fetchJson, fetchSource, mapPool, stripHtml } from "./crawler-http";
import { createPostingSelection, selectPostingRows } from "./crawl-policy";
import { careerSession, jobPostingJson, publicDate as date, requireRows } from "./career-session";
import { createDecipheriv } from "node:crypto";
import { ruleRejection } from "./job-classifier";
import { syncDelay } from "./sync-control";

const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const names = (rows: any, ...keys: string[]) => Array.isArray(rows) ? rows.map(row => typeof row === "string" ? row : keys.map(k => row?.[k]).find(Boolean)).filter(Boolean).join(" · ") : clean(rows);
const jd = (...parts: unknown[]) => stripHtml(parts.filter(Boolean).join("\n\n"));
const content = (...parts: unknown[]) => { const text = jd(...parts); if (!text) throw new Error("原始职位职责与要求缺失，招聘类别不能替代完整 JD"); return text; };
const ensureJd = (jobs: JobRecord[]) => { for (const job of jobs) if (!job.title || !job.externalId || !job.description) throw new Error("职位关键字段或完整 JD 缺失，停止导入"); return jobs; };

export async function feishu(source: SourceRecord, account: string): Promise<JobRecord[]> {
  const origin = new URL(source.url).origin, session = careerSession();
  await (await session.fetch(source.url)).text();
  const headers: Record<string, string> = { "content-type": "application/json", origin, referer: source.url };
  const csrf = await (await session.fetch(`${origin}/api/v1/csrf/token`, { ...jsonPost({ portal_entrance: 1 }), headers })).json() as any;
  if (csrf.code !== 0 || !csrf.data?.token) throw new Error("飞书招聘匿名会话初始化失败");
  headers["x-csrf-token"] = headers["x-csrftoken"] = csrf.data.token;
  const selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let offset = 0; offset < 10000; offset += 50) {
    const body = { keyword: source.name.includes("Seed") ? "Seed" : "", limit: 50, offset, job_category_id_list: [], location_code_list: [], recruitment_id_list: [], job_function_id_list: [], portal_type: Number(account || (origin === "https://jobs.bytedance.com" ? 3 : 6)), portal_entrance: 1 };
    const data = await (await session.fetch(`${origin}/api/v1/search/job/posts`, { ...jsonPost(body), headers })).json() as any;
    if (data.code !== 0) throw new Error(`飞书招聘接口错误：${clean(data.message || data.code)}`);
    const rows = requireRows(data.data?.job_post_list, "飞书招聘");
    for (const row of rows) if (selection.accept(date(row.publish_time))) {
      const prefix = new URL(source.url).pathname.split("/position")[0].replace(/\/$/, "");
      const url = `${origin}${prefix}/position/${encodeURIComponent(row.id)}/detail`;
      const type = [row.recruit_type?.parent?.name, row.recruit_type?.name || row.recruit_type?.en_name].filter(Boolean).join(" · ");
      jobs.push({ externalId: clean(row.id), company: source.name, title: clean(row.title), canonicalUrl: url, applyUrl: url,
        location: names(row.city_list, "name", "en_name") || clean(row.city_info?.name || row.city_info?.en_name) || "未注明",
        employmentType: type, department: clean(row.job_function?.name || row.job_category?.name),
        description: jd(type && `招聘类别：${type}`, content(row.description, row.requirement)), postedAt: date(row.publish_time) });
    }
    if (!rows.length || offset + rows.length >= Number(data.data.count ?? data.data.total ?? Infinity) || rows.length < 50 || selection.stop(rows.map(r => date(r.publish_time)))) return ensureJd(jobs);
  }
  throw new Error("飞书招聘分页超过 10000 条，请缩小范围");
}

export async function salesforce(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [], selection = createPostingSelection(); let seen = 0;
  for (let page = 1; page <= 20; page++) {
    const data = await fetchJson(`https://a.sfdcstatic.com/digital/xsf/careers/prod/jobs_${page}.json`);
    const rows = requireRows(data.Report_Entry, "Salesforce"), total = Number(data.Total_Jobs);
    if (!Number.isFinite(total)) throw new Error("Salesforce 缺少总职位数");
    const selected = rows.filter(row => selection.accept(date(row.External_Job_Posting_Start_Date))
      && (!row.Countries?.length || row.Countries.some((c: string) => /United States|China|\bUSA?\b|中国|美国/i.test(c)))
      && !ruleRejection({ externalId: clean(row.Job_Requisition_Ref_ID), company: source.name, title: clean(row.Job_Posting_Title), location: clean(row.Job_Requisition_Primary_Location), canonicalUrl: source.url, description: "Pending full JD" }));
    jobs.push(...await mapPool(selected, async row => {
      let description = row.Job_Description;
      if (!description) {
        await syncDelay(500);
        const link = new URL(row.External_Job_Posting_Site), site = "External_Career_Site";
        const path = link.pathname.slice(link.pathname.indexOf(`/${site}`) + site.length + 1);
        const detail = await fetchJson(`${link.origin}/wday/cxs/salesforce/${site}${path}`);
        description = detail.jobPostingInfo?.jobDescription;
      }
      return {
      externalId: clean(row.Job_Requisition_Ref_ID), company: source.name, title: clean(row.Job_Posting_Title),
      canonicalUrl: clean(row.External_Job_Posting_Site), applyUrl: clean(row.External_Job_Posting_Site),
      location: [clean(row.Job_Requisition_Primary_Location) || names(row.Locations, "name"), names(row.Countries, "name")].filter(Boolean).join(" · "), department: clean(row.Job_Family_Group), employmentType: [row.Time_Type, row.Employee_Type].filter(Boolean).join(" · "),
      description: jd(description), postedAt: date(row.External_Job_Posting_Start_Date) };
    }, 1));
    seen += rows.length;
    if (seen >= total) return ensureJd(jobs);
    if (!rows.length) throw new Error("Salesforce 分页提前为空，数据未取全");
  }
  throw new Error("Salesforce 分页超过上限");
}

export async function dify(source: SourceRecord): Promise<JobRecord[]> {
  const data = await fetchJson("https://qcnurokxgtyuimuixztr.supabase.co/functions/v1/public-jobs?lang=en");
  // CMS creation/update timestamps are not claimed as publication dates.
  return ensureJd(selectPostingRows(requireRows(data.jobs, "Dify"), () => null).map(row => {
    const url = `https://join.dify.ai/apply.html?role=${encodeURIComponent(clean(row.title))}`;
    return { externalId: clean(row.id), company: source.name, title: clean(row.title), canonicalUrl: url, applyUrl: url,
      location: clean(row.location), employmentType: clean(row.employment_type), department: clean(row.department), workplaceType: clean(row.work_site),
      description: jd(row.employment_type, row.seniority, content(row.content), row.benefits), postedAt: null };
  }));
}

export async function xiaomi(source: SourceRecord): Promise<JobRecord[]> {
  const selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 1; page <= 150; page++) {
    const data = await fetchJson(`https://hr.xiaomi.com/website/api/agent/searchJobPage?keyword=&cityZhNames=&pageSize=100&pageNum=${page}`);
    if (data.code !== 0) throw new Error(`小米招聘接口错误：${clean(data.message || data.code)}`);
    const rows = requireRows(data.data?.list, "小米");
    for (const row of rows) if (selection.accept(date(row.publishTime))) jobs.push({ externalId: clean(row.jobPostId || row.id), company: source.name,
      title: clean(row.title), canonicalUrl: clean(row.url), applyUrl: clean(row.url), location: names(row.cityZhNames, "name"), department: clean(row.levelOneDeptName),
      description: jd(row.description, row.requirement), postedAt: date(row.publishTime) });
    // This feed is not date sorted. Do not stop just because one page is old.
    if (!rows.length || page * 100 >= Number(data.data.total ?? Infinity) || rows.length < 100 || rows.every(r => !date(r.publishTime)) && page >= 1) return ensureJd(jobs);
  }
  throw new Error("小米招聘分页超过上限");
}

export async function beisen(source: SourceRecord): Promise<JobRecord[]> {
  const origin = new URL(source.url).origin, selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 0; page < 150; page++) {
    const data = await fetchJson(`${origin}/api/Jobad/GetJobAdPageList`, jsonPost({ PageIndex: page, PageSize: 100, KeyWords: "", SpecialType: 0, PortalId: "", DisplayFields: ["Category", "Kind", "LocId", "LocNames", "PostDate", "ClassificationOne", "Duty", "Require", "JobAdId"] }));
    if (data.Code !== 200) throw new Error(`北森招聘接口错误：${clean(data.Message || data.Code)}`);
    const rows = requireRows(data.Data, "北森招聘");
    for (const row of rows) if (selection.accept(date(row.PostDateInt || row.PostDate))) {
      const url = `${origin}/jobdetail/${encodeURIComponent(row.JobAdId)}`;
      jobs.push({ externalId: clean(row.JobAdId || row.Id), company: source.name, title: clean(row.JobAdName), canonicalUrl: url, applyUrl: url,
        location: names(row.LocNames, "name", "Name"), department: clean(row.ClassificationOne), employmentType: clean(row.Kind),
        description: jd(row.Category, row.Kind, content(row.Duty, row.Require)), postedAt: date(row.PostDateInt || row.PostDate) });
    }
    if (!rows.length || (page + 1) * 100 >= Number(data.Count) || rows.length < 100) return ensureJd(jobs);
  }
  throw new Error("北森招聘分页超过上限");
}

export async function kuaishou(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [], selection = createPostingSelection();
  for (let page = 1; page <= 200; page++) {
  const data = await fetchJson(`https://zhaopin.kuaishou.cn/recruit/e/api/v1/open/positions/simple?pageNum=${page}&pageSize=10&positionNatureCode=C001&recruitProject=socialr`, { headers: { referer: "https://zhaopin.kuaishou.cn/recruit/e/" } });
  if (data.code !== 0 && data.code !== 200) throw new Error(`快手招聘接口错误：${clean(data.message || data.code)}`);
  const rows = requireRows(data.result?.list, "快手");
  jobs.push(...rows.filter(row => selection.accept(date(row.releaseTime))).map(row => {
    const url = `https://zhaopin.kuaishou.cn/recruit/e/#/official/social/job-info/${row.id}`;
    return { externalId: clean(row.id), company: source.name, title: clean(row.name), canonicalUrl: url, applyUrl: url,
      location: clean(row.workLocationName || row.workLocationCode), department: clean(row.positionCategoryName),
      description: jd(row.description, row.positionDemand), postedAt: date(row.releaseTime) };
  }));
  if (!rows.length || page * 10 >= Number(data.result.total) || selection.stop(rows.map(r => date(r.releaseTime)))) return ensureJd(jobs);
  }
  throw new Error("快手招聘分页超过上限");
}

export async function meituan(source: SourceRecord): Promise<JobRecord[]> {
  const selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 1; page <= 200; page++) {
    const data = await fetchJson("https://zhaopin.meituan.com/api/official/job/getJobList", jsonPost({ page: { pageNo: page, pageSize: 50 }, jobShareType: "1", keywords: "", cityList: [], department: [], jfJgList: [], jobType: [], typeCode: [], specialCode: [] }));
    if (data.status !== 1) throw new Error(`美团招聘接口错误：${clean(data.message || data.status)}`);
    const rows = requireRows(data.data?.list, "美团");
    for (const row of rows) if (selection.accept(date(row.firstPostTime))) {
      const url = `https://zhaopin.meituan.com/web/position/detail?jobUnionId=${encodeURIComponent(row.jobUnionId)}`;
      jobs.push({ externalId: clean(row.jobUnionId), company: source.name, title: clean(row.name), canonicalUrl: url, applyUrl: url,
        location: names(row.cityList, "name"), department: clean(row.jobFamily),
        description: jd(row.projectName, row.workYear, content(row.jobDuty, row.jobRequirement)), postedAt: date(row.firstPostTime) });
    }
    if (!rows.length || rows.length < 50 || selection.stop(rows.map(r => date(r.firstPostTime))) || page * 50 >= Number(data.data.total ?? Infinity)) return ensureJd(jobs);
  }
  throw new Error("美团招聘分页超过上限");
}

export async function gem(source: SourceRecord, account: string): Promise<JobRecord[]> {
  account ||= new URL(source.url).pathname.split("/").filter(Boolean)[0];
  if (!account) throw new Error("Gem 需要公司的招聘板地址");
  const query = "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { name city isoCountry isRemote } job { department { name } locationType employmentType } } } }";
  const data = await fetchJson("https://jobs.gem.com/api/public/graphql/batch", jsonPost([{ operationName: "JobBoardList", variables: { boardId: account }, query }]));
  if (data[0]?.errors) throw new Error("Gem 公开职位接口错误");
  const rows = selectPostingRows(requireRows(data[0]?.data?.oatsExternalJobPostings?.jobPostings, "Gem"), () => null);
  return ensureJd(await mapPool(rows, async row => {
    const url = `https://jobs.gem.com/${account}/${row.extId}`;
    const html = await (await fetchSource(url)).text();
    // Gem exposes the entire posting as its server-rendered description metadata.
    const description = html.match(/<meta\s+name="description"\s+content="([\s\S]*?)"\s*\/?\s*>/i)?.[1];
    if (!description || description.length < 150) throw new Error(`Gem 职位详情缺失：${row.extId}`);
    return { externalId: clean(row.extId), company: source.name, title: clean(row.title), canonicalUrl: url, applyUrl: url,
      location: row.locations.map((l: any) => [l.name, l.isoCountry].filter(Boolean).join(", ")).join(" · "), department: clean(row.job?.department?.name), employmentType: clean(row.job?.employmentType), workplaceType: clean(row.job?.locationType),
      description: jd(description), postedAt: null };
  }));
}

export async function alibaba(source: SourceRecord, account: string): Promise<JobRecord[]> {
  const session = careerSession(), origin = new URL(source.url).origin;
  const html = await (await session.fetch(source.url)).text();
  const token = html.match(/name=["']_csrf["'][^>]*content=["']([^"']+)/)?.[1] || session.cookie(origin, "XSRF-TOKEN");
  if (!token) throw new Error("阿里招聘匿名 CSRF 初始化失败");
  const headers = { "content-type": "application/json", origin, referer: source.url };
  const request = async (path: string, body: unknown) => {
    const data = await (await session.fetch(`${origin}${path}?_csrf=${encodeURIComponent(token)}`, { ...jsonPost(body), headers })).json() as any;
    if (data.success !== true) throw new Error(`阿里招聘接口错误：${clean(data.errorMsg || data.errorCode)}`);
    return data;
  };
  const campus = account === "campus", selection = createPostingSelection(), jobs: JobRecord[] = [];
  // Discover current recruitment batches instead of hardcoding the graduation year.
  let batches: any[] = [{ id: "" }];
  if (campus) {
    const result = await request("/searchCondition/listBatch", { channel: "campus_group_official_site", language: "zh" });
    batches = [...requireRows(result.content?.graduate, "阿里校招批次"), ...(result.content.internship ?? [])];
    if (!batches.length) throw new Error("阿里暂无公开校招批次");
  }
  const seen = new Set<string>();
  for (const batch of batches) for (let page = 1; page <= 150; page++) {
    const result = await request("/position/search", { pageIndex: page, pageSize: 50, batchId: batch.id, channel: campus ? "campus_group_official_site" : "group_official_site", language: "zh", categories: "", deptCodes: [], key: "", regions: "", subCategories: "" });
    const rows = result.content?.datas === null && result.content?.totalCount === 0 ? [] : requireRows(result.content?.datas, "阿里招聘");
    for (const row of rows) {
      if (seen.has(clean(row.id))) continue; seen.add(clean(row.id));
      if (!selection.accept(date(row.publishTime))) continue;
      const path = campus ? "/campus/position-detail" : "/off-campus/position-detail";
      const url = `${origin}${path}?positionId=${row.id}${campus ? `&batchId=${batch.id}` : ""}`;
      jobs.push({ externalId: clean(row.id), company: source.name, title: clean(row.name), canonicalUrl: url, applyUrl: url,
        location: names(row.workLocations, "name"), department: clean(row.categoryName), employmentType: clean(row.categoryType),
        description: jd(row.batchName || batch.name, content(row.description, row.requirement)), postedAt: date(row.publishTime) });
    }
    if (!rows.length || page * 50 >= Number(result.content.totalCount) || selection.stop(rows.map(r => date(r.publishTime)))) break;
    if (page === 150) throw new Error("阿里招聘分页超过上限");
  }
  return ensureJd(jobs);
}

export async function netease(source: SourceRecord): Promise<JobRecord[]> {
  // The public list includes full duties and requirements, but only an updateTime.
  const data = await fetchJson("https://hr.163.com/api/hr163/position/queryPage", jsonPost({ currentPage: 1, pageSize: 50 }));
  if (data.code !== 200 && data.code !== 0) throw new Error(`网易招聘接口错误：${clean(data.message || data.code)}`);
  return ensureJd(selectPostingRows(requireRows(data.data?.list, "网易"), () => null).map(row => {
    const url = `https://hr.163.com/job-detail.html?id=${encodeURIComponent(row.id)}`;
    return { externalId: clean(row.id), company: source.name, title: clean(row.name), canonicalUrl: url, applyUrl: url,
      location: names(row.workPlaceNameList, "name"), department: clean(row.firstDepName), employmentType: clean(row.reqWorkYearsName),
      description: jd(row.reqWorkYearsName, content(row.description, row.requirement)), postedAt: null };
  }));
}

export async function xiaohongshu(source: SourceRecord): Promise<JobRecord[]> {
  const selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 1; page <= 200; page++) {
    const data = await fetchJson("https://job.xiaohongshu.com/websiterecruit/position/pageQueryPosition", jsonPost({ positionName: "", pageNum: page, pageSize: 50, recruitType: "social" }));
    if (data.success !== true || data.statusCode !== 200) throw new Error(`小红书招聘接口错误：${clean(data.errorMsg || data.statusCode)}`);
    const rows = requireRows(data.data?.list, "小红书");
    for (const row of rows) if (selection.accept(date(row.publishTime))) {
      const url = `https://job.xiaohongshu.com/social/position/${row.positionId}`;
      jobs.push({ externalId: clean(row.positionId), company: source.name, title: clean(row.positionName), canonicalUrl: url, applyUrl: url,
        location: clean(row.workplace), department: clean(row.jobType), description: jd(row.jobProjectName, row.duty, row.qualification), postedAt: date(row.publishTime) });
    }
    if (!rows.length || page * 50 >= Number(data.data.total) || rows.length < 50) return ensureJd(jobs);
  }
  throw new Error("小红书招聘分页超过上限");
}

export async function jdcom(source: SourceRecord): Promise<JobRecord[]> {
  const selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let page = 1; page <= 200; page++) {
    const data = await fetchJson("https://zhaopin.jd.com/web/job/job_list", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ pageIndex: String(page), pageSize: "50", workCityJson: "[]", jobTypeJson: "[]", jobSearch: "", depTypeJson: "[]" }).toString() });
    const rows = requireRows(data, "京东");
    for (const row of rows) if (selection.accept(date(row.publishTime || row.formatPublishTime))) {
      // The public JD expands inline on this page; use its real application target.
      const url = `https://zhaopin.jd.com/web/job/job_info_list/3?positionId=${encodeURIComponent(row.positionId || row.id)}&requirementId=${encodeURIComponent(row.requirementId || row.id)}`;
      jobs.push({ externalId: clean(row.requirementId || row.positionId || row.id), company: source.name, title: clean(row.positionNameOpen || row.positionName), canonicalUrl: url, applyUrl: url,
        location: clean(row.workCity), department: clean(row.positionDeptName || row.jobType), description: jd(row.workContent, row.qualification), postedAt: date(row.publishTime || row.formatPublishTime) });
    }
    if (!rows.length || rows.length < 50 || rows.every(r => !date(r.publishTime || r.formatPublishTime))) return ensureJd(jobs);
  }
  throw new Error("京东招聘分页超过上限");
}

export async function tiktok(source: SourceRecord): Promise<JobRecord[]> {
  const data = await fetchJson("https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts", {
    ...jsonPost({ recruitment_id_list: [], job_category_id_list: [], subject_id_list: [], location_code_list: [], keyword: "", limit: 50, offset: 0 }),
    headers: { "content-type": "application/json", "website-path": "tiktok", origin: "https://lifeattiktok.com", referer: "https://lifeattiktok.com/" },
  });
  if (data.code !== 0) throw new Error(`TikTok 接口错误：${clean(data.message || data.code)}`);
  return ensureJd(selectPostingRows(requireRows(data.data?.job_post_list, "TikTok"), () => null).map(row => {
    const url = `https://lifeattiktok.com/search/${row.id}`, cities: string[] = [];
    for (let city = row.city_info; city; city = city.parent) if (city.en_name || city.name) cities.push(city.en_name || city.name);
    return { externalId: clean(row.id), company: source.name, title: clean(row.title), canonicalUrl: url, applyUrl: url,
      location: cities.join(", "), employmentType: clean(row.recruit_type?.en_name || row.recruit_type?.name), department: clean(row.job_category?.en_name),
      description: jd(row.recruit_type?.en_name, content(row.description, row.requirement)), postedAt: null };
  }));
}

export async function meta(source: SourceRecord): Promise<JobRecord[]> {
  const session = careerSession(), origin = "https://www.metacareers.com";
  const html = await (await session.fetch(`${origin}/jobsearch/`)).text();
  const lsd = html.match(/\["LSD",\[\],\{"token":"([^"]+)/)?.[1];
  if (!lsd) throw new Error("Meta 公开匿名会话初始化失败");
  const variables = { search_input: { q: null, divisions: [], offices: [], roles: [], leadership_levels: [], saved_jobs: [], saved_searches: [], sub_teams: [], teams: [], is_leadership: false, is_remote_only: false, sort_by_new: true, results_per_page: null }, viewasUserID: null, isLoggedIn: false };
  const response = await session.fetch(`${origin}/graphql`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-fb-lsd": lsd, origin, referer: `${origin}/jobsearch/` },
    body: new URLSearchParams({ av: "0", __user: "0", __a: "1", __comet_req: "31", lsd, doc_id: "40084319704492118", fb_api_caller_class: "RelayModern", fb_api_req_friendly_name: "CareersJobSearchResultsDataQuery", variables: JSON.stringify(variables) }).toString() });
  const data = JSON.parse((await response.text()).replace(/^for\s*\(;;\);/, ""));
  if (data.errors) throw new Error("Meta 公开职位查询失败，官网查询版本可能已变更");
  const rows = selectPostingRows(requireRows(data.data?.job_search_with_featured_jobs_v2?.all_jobs, "Meta"), () => null);
  return ensureJd(await mapPool(rows, async row => {
    const url = `${origin}/profile/job_details/${row.id}/`, d = jobPostingJson(await (await session.fetch(url)).text());
    return { externalId: clean(row.id), company: source.name, title: clean(d.title || row.title), canonicalUrl: url, applyUrl: url,
      location: names(row.locations, "name"), employmentType: clean(d.employmentType), department: names(row.teams, "name"),
      description: jd(d.description, d.responsibilities, d.qualifications), postedAt: date(d.datePosted) };
  }, 3));
}

// Moka's own public frontend decodes anonymous job responses with the returned key
// and the public page's aesIv. This is transport encoding, not an account credential.
export function decodeMoka(body: any, iv: string) {
  if (!body?.necromancer) return body;
  if (typeof body.necromancer !== "string" || body.necromancer.length !== 16 || iv.length !== 16) throw new Error("Moka 公开响应编码已改变");
  const decipher = createDecipheriv("aes-128-cbc", Buffer.from(body.necromancer), Buffer.from(iv));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body.data, "base64")), decipher.final()]).toString("utf8"));
}

export async function moka(source: SourceRecord, account: string): Promise<JobRecord[]> {
  const session = careerSession(), html = await (await session.fetch(source.url)).text();
  const value = html.match(/<input[^>]*id="init-data"[^>]*value="([\s\S]*?)"[^>]*>/)?.[1];
  if (!value) throw new Error("Moka 公开招聘配置缺失");
  const config = JSON.parse(value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  const parts = new URL(source.url).pathname.split("/").filter(Boolean), orgId = account || parts[1], siteId = Number(parts[2]);
  if (!config.aesIv || !orgId || !siteId) throw new Error("Moka 站点参数缺失");
  const selection = createPostingSelection(), jobs: JobRecord[] = [];
  for (let offset = 0; offset < 10000; offset += 50) {
    const response = await session.fetch("https://app.mokahr.com/api/outer/ats-apply/website/jobs", jsonPost({ orgId, siteId, limit: 50, offset, locale: "zh-CN" }));
    const envelope = decodeMoka(await response.json(), config.aesIv);
    if (envelope.code !== 0 || !envelope.success) throw new Error(`Moka 接口错误：${clean(envelope.msg || envelope.code)}`);
    const data = envelope.data, chinaDate = (value: unknown) => date(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value) ? `${value}+08:00` : value);
    const rows = requireRows(data?.jobs, "Moka");
    jobs.push(...await mapPool(rows.filter(row => selection.accept(chinaDate(row.publishedAt))), async row => {
      const detailResponse = await session.fetch("https://app.mokahr.com/api/outer/ats-apply/website/job", jsonPost({ orgId, siteId, jobId: row.id, locale: "zh-CN" }));
      const detail = decodeMoka(await detailResponse.json(), config.aesIv);
      if (detail.code !== 0 || !detail.data?.jobDescription) throw new Error(`Moka 完整 JD 缺失：${row.id}`);
      const d = detail.data;
      const url = `${source.url.replace(/\/$/, "")}#/job/${encodeURIComponent(row.id)}`;
      return { externalId: clean(row.id), company: source.name, title: clean(row.title), canonicalUrl: url, applyUrl: url,
        location: (d.locations ?? row.locations ?? []).map((l: any) => [l.country, l.provinceName, l.cityName].filter(Boolean).join(" ")).join(" · "), department: clean(row.department?.name), employmentType: clean(d.commitment),
        description: jd(d.commitment, content(d.jobDescription)), postedAt: chinaDate(row.publishedAt) };
    }, 3));
    // Prioritized/pinned postings make this list unsorted by publication date.
    if (!rows.length || offset + rows.length >= Number(data.jobStats?.total) || rows.length < 50 || rows.every(r => !r.publishedAt) && offset >= 0) return ensureJd(jobs);
  }
  throw new Error("Moka 招聘分页超过上限");
}

export async function baidu(source: SourceRecord): Promise<JobRecord[]> {
  const session = careerSession(), origin = "https://talent.baidu.com";
  await (await session.fetch(`${origin}/jobs/list`)).text();
  const jobs: JobRecord[] = [], selection = createPostingSelection(), seen = new Set<string>();
  for (const recruitType of ["GRADUATE", "INTERN"]) for (let page = 1; page <= 200; page++) {
    const body = new URLSearchParams({ recruitType, workPlace: "", pageSize: "10", keyWord: "", postType: "", curPage: String(page), projectType: "" });
    const response = await session.fetch(`${origin}/httservice/getPostListNew`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8", referer: `${origin}/jobs/list`, origin, "x-requested-with": "XMLHttpRequest" }, body: body.toString() });
    const data = await response.json() as any;
    if (data.status !== "ok") throw new Error(`百度招聘接口错误：${clean(data.message || data.status)}`);
    const rows = requireRows(data.data?.list, "百度");
    for (const row of rows) {
      if (seen.has(clean(row.postId))) continue; seen.add(clean(row.postId));
      if (!selection.accept(date(row.publishDate))) continue;
      const url = `${origin}/jobs/detail/${recruitType}/${encodeURIComponent(row.postId)}`;
      jobs.push({ externalId: clean(row.postId), company: source.name, title: clean(row.name), canonicalUrl: url, applyUrl: url,
        location: clean(row.workPlace), department: clean(row.postType), employmentType: recruitType === "INTERN" ? "实习" : "应届生",
        description: jd(recruitType === "INTERN" ? "招聘类别：实习生" : "招聘类别：校园招聘应届生", content(row.workContent, row.serviceCondition)), postedAt: date(row.publishDate) });
    }
    if (!rows.length || page * 10 >= Number(data.data.total) || rows.length < 10) break;
    if (page === 200) throw new Error("百度招聘分页超过上限");
  }
  return ensureJd(jobs);
}

export async function antgroup(source: SourceRecord): Promise<JobRecord[]> {
  const jobs: JobRecord[] = [], selection = createPostingSelection();
  for (let page = 1; page <= 500; page++) {
    const data = await fetchJson("https://hrcareersweb.antgroup.com/api/social/position/search", jsonPost({ key: "", regions: "", categories: "", subCategories: "", bgCode: "", socialQrCode: "", pageIndex: page, pageSize: 20, channel: "group_official_site", language: "zh" }));
    if (data.success !== true) throw new Error(`蚂蚁招聘接口错误：${clean(data.errorMsg || data.errorCode)}`);
    const rows = requireRows(data.content, "蚂蚁集团");
    for (const row of rows) if (selection.accept(date(row.publishTime))) {
      const url = `https://talent.antgroup.com/off-campus-position/${row.id}`;
      jobs.push({ externalId: clean(row.id), company: source.name, title: clean(row.name), canonicalUrl: url, applyUrl: url,
        location: names(row.workLocations, "name"), department: clean(row.department), description: jd(row.description, row.requirement), postedAt: date(row.publishTime) });
    }
    if (!rows.length || page * 20 >= Number(data.totalCount) || rows.length < 20) return ensureJd(jobs);
  }
  throw new Error("蚂蚁招聘分页超过上限");
}

export const additionalAdapters: Partial<Record<SourceAdapter, (source: SourceRecord, account: string) => Promise<JobRecord[]>>> = {
  feishu, salesforce, dify, xiaomi, beisen, kuaishou, meituan, gem, alibaba, netease, xiaohongshu, jdcom, tiktok, meta, moka, baidu, antgroup,
};
