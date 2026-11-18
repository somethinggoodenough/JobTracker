import type { CrawlBatch, JobRecord, SourceRecord } from "./job-types";
import { clean, fetchSource, mapPool, stripHtml } from "./crawler-http";
import { UNKNOWN_DATE_LIMIT, isCrawlCandidate } from "./crawl-policy";
import { throwIfSyncCancelled } from "./sync-control";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const communitySources = [
  { name: "Simplify / Pitt CSC 实习（GitHub）", url: "https://github.com/SimplifyJobs/Summer2027-Internships" },
  { name: "Simplify / Coder Quad New Grad（GitHub）", url: "https://github.com/SimplifyJobs/New-Grad-Positions" },
];
type Listing = { id: string; company: string; title: string; url: string; location: string; added: number; simplifyId?: string };

// Accept repository roots, GitHub blob URLs or raw public files; no authenticated API is needed.
export function githubListingsUrl(value: string): string {
  const url = new URL(value), parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:") throw new Error("GitHub 职位列表必须使用 HTTPS");
  if (url.hostname === "simplify.jobs") {
    const summer = /^\/l\/Top-Summer-Internships-(20\d\d)\/?$/.exec(url.pathname);
    if (summer) return `https://raw.githubusercontent.com/SimplifyJobs/Summer${summer[1]}-Internships/dev/.github/scripts/listings.json`;
    throw new Error("请使用 SimplifyJobs 的实习或 New-Grad-Positions 公开仓库链接，或 Simplify 的 Top-Summer-Internships 列表链接");
  }
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 4 && url.pathname.endsWith(".json")) {
    url.search = ""; url.hash = ""; return url.href;
  }
  if (url.hostname !== "github.com" || parts.length < 2) throw new Error("请提供 GitHub 仓库或公开 listings.json 链接");
  const [owner, repo] = parts;
  if (parts[2] === "blob" && parts.length >= 5 && url.pathname.endsWith(".json")) return `https://raw.githubusercontent.com/${parts.filter((_, i) => i !== 2).map(encodeURIComponent).join("/")}`;
  if (parts.length === 2 && owner.toLowerCase() === "simplifyjobs" && /^(Summer20\d\d-Internships|New-Grad-Positions)$/i.test(repo))
    return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dev/.github/scripts/listings.json`;
  throw new Error("此仓库未配置职位文件，请填写 blob 或 raw 格式的 listings.json 链接；目前支持 Simplify 格式 JSON");
}

function applicationUrl(value: unknown): string | null {
  try {
    const url = new URL(clean(value));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".") || /(^|\.)(localhost|local|internal)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|source$|ref$|gh_src$)/i.test(key)) url.searchParams.delete(key);
    const parts = url.pathname.split("/").filter(Boolean);
    // Aggregator links often point at an application form for the same ATS posting.
    if (["jobs.ashbyhq.com", "jobs.lever.co"].includes(url.hostname) && parts[0] && UUID.test(parts[1] || "")) {
      url.protocol = "https:"; url.pathname = `/${parts[0]}/${parts[1]}`; url.search = "";
    } else if (url.hostname === "apply.workable.com" && parts[1] === "j" && parts[2]) {
      url.protocol = "https:"; url.pathname = `/${parts[0]}/j/${parts[2]}`; url.search = "";
    } else if (["boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io"].includes(url.hostname) && parts[1] === "jobs" && /^\d+$/.test(parts[2] || "")) {
      url.protocol = "https:"; url.hostname = url.hostname.replace(/^boards\./, "job-boards."); url.search = "";
    }
    return url.href.replace(/\/$/, "");
  } catch { return null; }
}

export function parseCommunityListings(data: unknown): Listing[] {
  if (!Array.isArray(data)) throw new Error("GitHub 职位列表结构已变更：需要 Simplify 格式 JSON 数组");
  const result: Listing[] = [], seen = new Set<string>(); let malformed = 0;
  for (const row of data) {
    if (!row || typeof row !== "object" || typeof row.active !== "boolean" || typeof row.is_visible !== "boolean") { malformed++; continue; }
    if (!row.active || !row.is_visible) continue;
    const url = applicationUrl(row.url), id = clean(row.id), title = clean(row.title), company = clean(row.company_name);
    if (!url || !id || !title || !company || !Array.isArray(row.locations) || row.locations.some((v: unknown) => typeof v !== "string")) { malformed++; continue; }
    const timestamp = typeof row.date_posted === "number" && Number.isFinite(row.date_posted) ? row.date_posted : 0;
    result.push({ id, title, company, url, location: row.locations.join(" · ") || "未注明", added: timestamp,
      ...(row.source === "Simplify" && UUID.test(id) ? { simplifyId: id } : {}) });
  }
  if (malformed) throw new Error(`GitHub 职位列表有 ${malformed} 条结构异常，不能当作完整抓取`);
  // date_posted means inclusion in this community list, not the employer's original publication.
  return result.sort((a, b) => b.added - a.added).filter(row => { if (seen.has(row.url)) return false; seen.add(row.url); return true; });
}

export function parseSimplifyDetail(html: string, id: string, listing?: Listing): JobRecord | null {
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  let detail: any;
  try { detail = match ? JSON.parse(match[1])?.props?.pageProps?.jobPosting : null; } catch {}
  if (!detail || detail.id !== id || typeof detail.title !== "string" || !detail.title.trim()
    || typeof detail.description !== "string" || !detail.description.trim() || typeof detail.job?.company?.name !== "string"
    || !detail.job.company.name.trim() || typeof detail.active !== "boolean" || typeof detail.visible !== "boolean")
    throw new Error("Simplify 详情结构已变更或缺少完整 JD");
  if (detail.active === false || detail.visible === false || detail.archive === true) return null;
  const description = stripHtml(detail.description);
  if (!description) throw new Error("Simplify 职位 JD 为空");
  const location = Array.isArray(detail.locations) ? detail.locations.map((l: any) => typeof l === "string" ? l : [l?.value, l?.country].filter(Boolean).join(", ")).filter(Boolean).join(" · ") : "";
  const url = listing?.url || `https://simplify.jobs/p/${id}`;
  return { externalId: listing?.id || id, company: clean(detail.job.company.name), title: clean(detail.title),
    canonicalUrl: url, applyUrl: listing?.url || applicationUrl(detail.url) || url, location: location || listing?.location || "未注明",
    employmentType: /intern|co.op/i.test(detail.title) ? "Internship" : null,
    salary: detail.min_salary != null || detail.max_salary != null ? `${clean(detail.currency_type)} ${clean(detail.min_salary)}–${clean(detail.max_salary)}`.trim() : null,
    description,
    // start_date, date_display and even datePosted JSON-LD may reflect Simplify updates.
    // None of them establish the employer's original publication date.
    postedAt: null };
}

async function atsDetail(listing: Listing): Promise<JobRecord | null> {
  const url = new URL(listing.url), parts = url.pathname.split("/").filter(Boolean);
  let detail: any, description = "", postedAt: string | null = null, location = listing.location;
  if (["boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io"].includes(url.hostname) && parts[0] && /^\d+$/.test(parts.at(-1) || "")) {
    const api = url.hostname.includes(".eu.") ? "boards-api.eu.greenhouse.io" : "boards-api.greenhouse.io";
    detail = await (await fetchSource(`https://${api}/v1/boards/${encodeURIComponent(parts[0])}/jobs/${parts.at(-1)}`)).json() as any;
    description = stripHtml(detail.content); location = clean(detail.location?.name) || location;
    postedAt = clean(detail.first_published) || null;
  } else if (url.hostname === "jobs.lever.co" && parts[0] && UUID.test(parts[1] || "")) {
    detail = await (await fetchSource(`https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}/${parts[1]}?mode=json`)).json() as any;
    description = stripHtml([detail.descriptionPlain || detail.description, ...(detail.lists || []).map((l: any) => `${l.text}\n${l.content}`), detail.additionalPlain || detail.additional].filter(Boolean).join("\n\n"));
    location = clean(detail.categories?.location) || location;
    postedAt = typeof detail.createdAt === "number" && Number.isFinite(new Date(detail.createdAt).getTime()) ? new Date(detail.createdAt).toISOString() : null;
  } else if (url.hostname === "apply.workable.com" && parts[1] === "j" && parts[2]) {
    detail = await (await fetchSource(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(parts[0])}/jobs/${encodeURIComponent(parts[2])}`)).json() as any;
    description = stripHtml([detail.description, detail.requirements, detail.benefits].filter(Boolean).join("\n\n"));
    postedAt = clean(detail.published || detail.published_at) || null;
  } else throw new Error("原始申请网站尚无单岗位详情适配器，且没有可用的 Simplify 详情");
  if (!description) throw new Error("原始网站未提供完整 JD");
  if (!isCrawlCandidate(postedAt)) return null;
  return { externalId: listing.id, company: listing.company, title: clean(detail.title || detail.text) || listing.title, canonicalUrl: listing.url, applyUrl: listing.url, location, description, postedAt };
}

async function selectedListings(source: SourceRecord): Promise<Listing[]> {
  const response = await fetchSource(githubListingsUrl(source.url));
  let data: unknown; try { data = await response.json(); } catch { throw new Error("GitHub 职位文件未返回有效 JSON"); }
  // Release the full historical feed before waiting for detail requests.
  return parseCommunityListings(data).slice(0, UNKNOWN_DATE_LIMIT);
}

export async function githubJobs(source: SourceRecord): Promise<CrawlBatch> {
  const selected = await selectedListings(source);
  const warnings = ["社区列表日期仅用于排序，不作为公司发布日期；按发布日期未知规则取收录时间最新的前 50 条，再获取真实 JD。"];
  const failures: string[] = []; let resolved = 0, closed = 0;
  const results = await mapPool<Listing, JobRecord | null>(selected, async listing => {
    try {
      let job: JobRecord | null;
      if (listing.simplifyId) {
        try { job = parseSimplifyDetail(await (await fetchSource(`https://simplify.jobs/p/${listing.simplifyId}`)).text(), listing.simplifyId, listing); }
        catch (error) {
          throwIfSyncCancelled();
          try { job = await atsDetail(listing); }
          catch (fallback) { throw new Error(`Simplify：${error instanceof Error ? error.message : "详情失败"}；原网站：${fallback instanceof Error ? fallback.message : "详情失败"}`); }
        }
      } else job = await atsDetail(listing);
      resolved++; if (!job) closed++;
      return job;
    } catch (error) { throwIfSyncCancelled(); failures.push(`${listing.company} / ${listing.title}：${error instanceof Error ? error.message : "详情读取失败"}`); return null; }
  });
  if (selected.length && !resolved) throw new Error(`GitHub 列表可读，但 ${selected.length} 条详情均未完成：${failures.slice(0, 2).join("；")}`);
  if (failures.length) warnings.push(`详情部分完成：${selected.length} 条中 ${failures.length} 条失败或缺少完整 JD，已跳过。${failures.slice(0, 3).join("；")}`);
  if (closed) warnings.push(`${closed} 条已关闭或原网站日期不在纽约当天，已跳过。`);
  return Object.assign(results.filter((job): job is JobRecord => job !== null), { warnings });
}
