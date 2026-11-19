import { clean, fetchJson, stripHtml } from "./crawler-http";
import { UNKNOWN_DATE_LIMIT } from "./crawl-policy";
import { mapDetails } from "./detail-cache";
import type { CrawlBatch, JobRecord, SourceRecord } from "./job-types";
import { throwIfSyncCancelled } from "./sync-control";

const origin = "https://jobs.mihoyo.com";
const api = "https://ats.openout.mihoyo.com/ats-portal/v1/job";
const social = "#/position";
const campus = "#/campus/position";

export function mihoyoBoard(url: URL) {
  if (url.hostname === "join.mihoyo.com" || url.hostname === "campus.mihoyo.com") return origin + "/" + campus;
  if (url.hostname === "jobs.mihoyo.com") return origin + "/" + (/^#\/campus(?:\/|$)/.test(url.hash) ? campus : social);
  return null;
}

type Posting = {
  id: string;
  title: string;
  addressDetailList?: { addressDetail?: string }[];
  competencyType?: string;
  jobNature?: string;
  projectName?: string;
  objectName?: string;
};

const postingId = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? value : "";

function requestJobs(path: "list" | "info", hireType: number, data: Record<string, string | number>) {
  return fetchJson(`${api}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, referer: origin + "/" },
    body: JSON.stringify({ ...data, channelDetailIds: [1], hireType }),
  });
}

export async function mihoyo(source: SourceRecord): Promise<CrawlBatch> {
  const board = mihoyoBoard(new URL(source.url));
  if (!board) throw new Error("米哈游适配器仅支持官方招聘网站");
  const hireType = board.endsWith(campus) ? 1 : 0;
  const listing = await requestJobs("list", hireType, { pageNo: 1, pageSize: UNKNOWN_DATE_LIMIT });
  const { list, total } = listing?.data ?? {};
  if (listing?.code !== 0 || !Array.isArray(list) || !Number.isSafeInteger(total) || total < 0
    || list.length < Math.min(total, UNKNOWN_DATE_LIMIT)) {
    throw new Error("米哈游职位列表响应异常或分页不完整");
  }

  // The public list and detail omit a publication date. Keep the board's order.
  const unique = new Map<string, Posting>();
  for (const row of list.slice(0, UNKNOWN_DATE_LIMIT)) {
    const id = postingId(row?.id);
    if (!id || typeof row.title !== "string" || !row.title.trim()) throw new Error("米哈游职位列表缺少有效编号或标题");
    if (!unique.has(id)) unique.set(id, row);
  }
  const failures: string[] = [];
  const details = await mapDetails([...unique.values()], row => [
    row.id, null, hireType, row.title, row.addressDetailList, row.jobNature, row.competencyType, row.projectName, row.objectName,
  ], async (row): Promise<JobRecord | null> => {
    try {
      const response = await requestJobs("info", hireType, { id: row.id });
      const detail = response?.data;
      if (response?.code !== 0 || postingId(detail?.id) !== row.id) throw new Error("职位详情不可用");
      const sections = [
        ["工作职责", detail.description], ["任职要求", detail.jobRequire],
        ["加分项", detail.addition], ["投递说明", detail.deliveryInstructions],
      ].map(([label, value]) => [label, typeof value === "string" ? stripHtml(value) : ""]);
      if (!sections[0][1] && !sections[1][1]) throw new Error("职位详情缺少 JD");
      const jobNature = clean(detail.jobNature || row.jobNature);
      const officialFields = [
        hireType === 1 ? "招聘渠道：校招" : "",
        jobNature ? `职位性质：${jobNature}` : "",
        row.projectName ? `招聘项目：${row.projectName}` : "",
        row.objectName ? `招聘范围：${row.objectName}` : "",
      ].filter(Boolean).join("\n");
      const locations: Posting["addressDetailList"] = Array.isArray(detail.addressDetailList) && detail.addressDetailList.length
        ? detail.addressDetailList : row.addressDetailList;
      const location = Array.isArray(locations) ? [...new Set(locations.map(item => clean(item?.addressDetail)).filter(Boolean))].join(" · ") : "";
      const url = `${board}/${row.id}`;
      return {
        externalId: row.id, company: "米哈游", title: clean(detail.title) || row.title.trim(), location: location || "未注明",
        canonicalUrl: url, applyUrl: url, department: clean(detail.competencyType || row.competencyType), employmentType: jobNature,
        description: [officialFields, ...sections.filter(([, value]) => value).map(([label, value]) => `${label}\n${value}`)].filter(Boolean).join("\n\n"),
        postedAt: null,
      };
    } catch (error) {
      throwIfSyncCancelled();
      failures.push(`${row.id}（${error instanceof Error ? error.message : "读取失败"}）`);
      return null;
    }
  });
  const jobs: CrawlBatch = details.filter(job => job !== null);
  if (failures.length) {
    if (!jobs.length) throw new Error(`米哈游职位详情均读取失败：${failures[0]}`);
    jobs.warnings = [`米哈游有 ${failures.length} 条职位详情读取失败：${failures.slice(0, 3).join("、")}`];
  }
  return jobs;
}
