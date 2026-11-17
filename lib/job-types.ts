export type SourceAdapter = "auto" | "greenhouse" | "lever" | "ashby" | "jsonld";

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

export type SyncSummary = {
  runId: number;
  status: "success" | "partial" | "failed";
  sourcesTotal: number;
  sourcesSucceeded: number;
  jobsSeen: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsDeleted: number;
  errors: string[];
};
