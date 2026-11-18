export type SourceAdapter = "auto" | "greenhouse" | "lever" | "ashby" | "workday" | "workable" | "jsonld"
  | "amazon" | "google" | "jibe" | "tencent" | "eightfold" | "oracle" | "smartrecruiters" | "apple" | "paycor" | "comeet"
  | "feishu" | "salesforce" | "dify" | "xiaomi" | "beisen" | "kuaishou" | "meituan" | "gem"
  | "alibaba" | "netease" | "xiaohongshu" | "jdcom" | "tiktok" | "meta" | "moka" | "baidu" | "antgroup" | "github_jobs";

export type JobRecord = {
  externalId: string;
  company: string;
  title: string;
  canonicalUrl: string;
  applyUrl?: string | null;
  location: string;
  workplaceType?: string | null;
  employmentType?: string | null;
  department?: string | null;
  salary?: string | null;
  description: string;
  postedAt?: string | null;
};

export type SourceRecord = {
  id: number;
  name: string;
  url: string;
  adapter: SourceAdapter;
};

export type CrawlBatch = JobRecord[] & { warnings?: string[] };

export type SyncSummary = {
  runId: number;
  status: "success" | "partial" | "failed" | "cancelled";
  sourcesTotal: number;
  sourcesSucceeded: number;
  jobsSeen: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsDeleted: number;
  jobsQueued: number;
  errors: string[];
};
