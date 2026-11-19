import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { DEFAULT_DAILY_AI_LIMIT } from "../lib/ai-settings";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  adapter: text("adapter").notNull().default("auto"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSuccessAt: text("last_success_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("sources_url_unique").on(table.url)]);

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => sources.id),
  sourceExternalKey: text("source_external_key").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  applyUrl: text("apply_url"),
  company: text("company").notNull(),
  title: text("title").notNull(),
  location: text("location").notNull().default("未注明"),
  workplaceType: text("workplace_type"),
  employmentType: text("employment_type"),
  department: text("department"),
  salary: text("salary"),
  description: text("description").notNull().default(""),
  postedAt: text("posted_at").notNull(),
  publicationVerified: integer("publication_verified", { mode: "boolean" }).notNull().default(false),
  freshness: text("freshness").notNull().default("uncertain"),
  freshnessReason: text("freshness_reason"),
  appearedAfter: text("appeared_after"),
  aiPolicy: text("ai_policy"),
  aiAnalysis: text("ai_analysis"),
  aiModel: text("ai_model"),
  aiReviewedAt: text("ai_reviewed_at"),
  crawlHash: text("crawl_hash"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("jobs_source_external_unique").on(table.sourceExternalKey),
  uniqueIndex("jobs_dedupe_unique").on(table.dedupeKey),
  uniqueIndex("jobs_canonical_url_unique").on(table.canonicalUrl),
  index("jobs_posted_at_idx").on(table.postedAt),
  index("jobs_company_idx").on(table.company),
  index("jobs_source_idx").on(table.sourceId),
]);

export const scrapeRuns = sqliteTable("scrape_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  sourcesTotal: integer("sources_total").notNull().default(0),
  sourcesSucceeded: integer("sources_succeeded").notNull().default(0),
  jobsSeen: integer("jobs_seen").notNull().default(0),
  jobsAdded: integer("jobs_added").notNull().default(0),
  jobsUpdated: integer("jobs_updated").notNull().default(0),
  jobsDeleted: integer("jobs_deleted").notNull().default(0),
  jobsQueued: integer("jobs_queued").notNull().default(0),
  aiRuleRejected: integer("ai_rule_rejected"),
  aiCacheHits: integer("ai_cache_hits"),
  aiRequests: integer("ai_requests"),
  errorSummary: text("error_summary"),
}, (table) => [index("scrape_runs_started_at_idx").on(table.startedAt)]);

export const scrapeSourceProgress = sqliteTable("scrape_source_progress", {
  runId: integer("run_id").notNull().references(() => scrapeRuns.id),
  sourceId: integer("source_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  stage: text("stage").notNull().default("queued"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  updatedAt: text("updated_at").notNull(),
  jobsTotal: integer("jobs_total").notNull().default(0),
  jobsProcessed: integer("jobs_processed").notNull().default(0),
  jobsAdded: integer("jobs_added").notNull().default(0),
  jobsUpdated: integer("jobs_updated").notNull().default(0),
  jobsIgnored: integer("jobs_ignored").notNull().default(0),
  jobsQueued: integer("jobs_queued").notNull().default(0),
  error: text("error"),
  metricsJson: text("metrics_json"),
}, (table) => [uniqueIndex("scrape_source_progress_run_source_idx").on(table.runId, table.sourceId)]);

export const crawlProviderCooldowns = sqliteTable("crawl_provider_cooldowns", {
  provider: text("provider").primaryKey(),
  address: text("address").notNull(),
  retryAfter: text("retry_after"),
  retryAt: integer("retry_at").notNull(),
});

export const sourcePostings = sqliteTable("source_postings", {
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  postingKey: text("posting_key").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  lastPosition: integer("last_position").notNull(),
  firstRunId: integer("first_run_id"),
}, t => [primaryKey({ columns: [t.sourceId, t.postingKey] }), index("source_postings_seen_idx").on(t.sourceId, t.lastSeenAt)]);

export const sourceSnapshots = sqliteTable("source_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  runId: integer("run_id").notNull().references(() => scrapeRuns.id),
  crawledAt: text("crawled_at").notNull(),
  observedCount: integer("observed_count").notNull(),
  scanComplete: integer("scan_complete").notNull(),
  status: text("status").notNull(),
}, t => [index("source_snapshots_time_idx").on(t.sourceId, t.crawledAt),
  uniqueIndex("source_snapshots_run_idx").on(t.sourceId, t.runId)]);

function plannerFields() {
  return {
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  };
}

export const plannerGoals = sqliteTable("planner_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }), ...plannerFields(),
  title: text("title").notNull(), why: text("why").notNull().default(""),
  priority: integer("priority").notNull().default(2), weeklyTargetMinutes: integer("weekly_target_minutes"),
  status: text("status").notNull().default("active"),
});

export const plannerProjects = sqliteTable("planner_projects", {
  id: integer("id").primaryKey({ autoIncrement: true }), ...plannerFields(),
  goalId: integer("goal_id").references(() => plannerGoals.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), title: text("title").notNull(),
  description: text("description").notNull().default(""), status: text("status").notNull().default("active"),
  repoPath: text("repo_path"), lastActivityAt: text("last_activity_at").notNull(),
}, t => [index("planner_projects_goal_idx").on(t.goalId)]);

export const plannerMilestones = sqliteTable("planner_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }), ...plannerFields(),
  projectId: integer("project_id").notNull().references(() => plannerProjects.id, { onDelete: "cascade" }),
  title: text("title").notNull(), doneCriteria: text("done_criteria").notNull().default(""),
  targetOn: text("target_on"), position: integer("position").notNull().default(0),
  status: text("status").notNull().default("open"), doneAt: text("done_at"), sourceRef: text("source_ref"),
}, t => [index("planner_milestones_project_idx").on(t.projectId, t.position), uniqueIndex("planner_milestones_source_idx").on(t.projectId, t.sourceRef)]);

export const plannerTasks = sqliteTable("planner_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }), ...plannerFields(),
  projectId: integer("project_id").notNull().references(() => plannerProjects.id, { onDelete: "cascade" }),
  milestoneId: integer("milestone_id").references(() => plannerMilestones.id, { onDelete: "set null" }),
  title: text("title").notNull(), notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("next"), dueOn: text("due_on"),
  estimateMinutes: integer("estimate_minutes"), actualMinutes: integer("actual_minutes"),
  blockedReason: text("blocked_reason"), checkBackOn: text("check_back_on"), unblockedAt: text("unblocked_at"),
  rolloverCount: integer("rollover_count").notNull().default(0), delayReason: text("delay_reason"),
  sourceRef: text("source_ref"), position: integer("position").notNull().default(0),
  startedAt: text("started_at"), doneAt: text("done_at"),
}, t => [index("planner_tasks_project_idx").on(t.projectId, t.milestoneId, t.position),
  index("planner_tasks_status_idx").on(t.status), uniqueIndex("planner_tasks_source_idx").on(t.projectId, t.sourceRef)]);

export const plannerEntries = sqliteTable("planner_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }), ...plannerFields(),
  projectId: integer("project_id").references(() => plannerProjects.id, { onDelete: "set null" }),
  taskId: integer("task_id").references(() => plannerTasks.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), body: text("body").notNull(),
  links: text("links").notNull().default("[]"), skills: text("skills").notNull().default("[]"),
  metric: text("metric"), cause: text("cause"), resumeCandidate: integer("resume_candidate").notNull().default(0),
}, t => [index("planner_entries_project_idx").on(t.projectId, t.createdAt)]);

export const plannerCards = sqliteTable("planner_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }), ...plannerFields(),
  entryId: integer("entry_id").references(() => plannerEntries.id, { onDelete: "set null" }),
  projectId: integer("project_id").notNull().references(() => plannerProjects.id, { onDelete: "cascade" }),
  question: text("question").notNull(), answer: text("answer").notNull(),
  intervalDays: integer("interval_days").notNull().default(1), dueOn: text("due_on").notNull(), lastResult: text("last_result"),
}, t => [index("planner_cards_due_idx").on(t.dueOn, t.projectId)]);

export const plannerDays = sqliteTable("planner_days", {
  day: text("day").primaryKey(), availableMinutes: integer("available_minutes"),
  focusTaskIds: text("focus_task_ids").notNull().default("[]"),
  startedAt: text("started_at"), closedAt: text("closed_at"), note: text("note").notNull().default(""),
});

export const plannerReviews = sqliteTable("planner_reviews", {
  week: text("week").primaryKey(), completedAt: text("completed_at"), notes: text("notes").notNull().default("{}"),
  version: integer("version").notNull().default(1),
});

export const plannerSettings = sqliteTable("planner_settings", {
  id: integer("id").primaryKey(), maxActiveProjects: integer("max_active_projects").default(3),
  maxDoingTasks: integer("max_doing_tasks").default(2), version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

// Deliberately independent of jobs/sources: a saved application outlives crawl retention.
export const applications = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalJobId: integer("original_job_id").notNull(),
  jobKey: text("job_key").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  applyUrl: text("apply_url"),
  company: text("company").notNull(),
  title: text("title").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  sourceName: text("source_name").notNull(),
  aiAnalysis: text("ai_analysis"),
  resume: text("resume").notNull().default(""),
  // Preserve selection metadata even if the library entry is later removed.
  resumeId: integer("resume_id"),
  resumeSnapshot: text("resume_snapshot"),
  email: text("email").notNull().default(""),
  appliedAt: text("applied_at"),
  status: text("status").notNull().default("saved"),
  statusAt: text("status_at").notNull(),
  version: integer("version").notNull().default(1),
  mutationToken: text("mutation_token").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("applications_job_key_unique").on(table.jobKey),
  uniqueIndex("applications_canonical_url_unique").on(table.canonicalUrl),
  index("applications_updated_at_idx").on(table.updatedAt),
]);

export const applicationEvents = sqliteTable("application_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  reachedAt: text("reached_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [index("application_events_application_idx").on(table.applicationId, table.id)]);

export const jobEvaluations = sqliteTable("job_evaluations", {
  cacheKey: text("cache_key").primaryKey(),
  decisionJson: text("decision_json").notNull(),
  model: text("model").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [index("job_evaluations_expiry_idx").on(table.expiresAt)]);

export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, table => [index("ai_usage_created_at_idx").on(table.createdAt)]);

export const aiDailyBudget = sqliteTable("ai_daily_budget", {
  day: text("day").primaryKey(),
  used: integer("used").notNull().default(0),
});

// Resume documents are independent of job crawling and its retention policy.
export const resumes = sqliteTable("resumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  targetRole: text("target_role").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  techStack: text("tech_stack").notNull().default("[]"),
  content: text("content").notNull().default(""),
  pdfKey: text("pdf_key"),
  pdfName: text("pdf_name"),
  pdfSize: integer("pdf_size"),
  version: integer("version").notNull().default(1),
  recordedAt: text("recorded_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("resumes_updated_at_idx").on(table.updatedAt)]);
export const aiSettings = sqliteTable("ai_settings", {
  id: integer("id").primaryKey(),
  dailyLimit: integer("daily_limit").default(DEFAULT_DAILY_AI_LIMIT),
  updatedAt: text("updated_at").notNull(),
});
export const screeningSettings = sqliteTable("screening_settings", {
  id: integer("id").primaryKey(),
  coarseJson: text("coarse_json").notNull().default("{}"),
  aiPrompt: text("ai_prompt"),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});
export const jobDiscoveries = sqliteTable("job_discoveries", {
  identity: text("identity").primaryKey(),
  firstSeenAt: text("first_seen_at").notNull(),
});
export const jobCandidates = sqliteTable("job_candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  canonicalUrl: text("canonical_url").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  contentHash: text("content_hash").notNull(),
  payloadJson: text("payload_json").notNull(),
  priority: integer("priority").notNull().default(0),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  nextRetryAt: text("next_retry_at").notNull(),
  lastError: text("last_error"),
  claimRunId: integer("claim_run_id"),
}, table => [uniqueIndex("job_candidates_url_unique").on(table.canonicalUrl),
  uniqueIndex("job_candidates_dedupe_unique").on(table.dedupeKey),index("job_candidates_expiry_idx").on(table.expiresAt),
  index("job_candidates_ready_idx").on(table.claimRunId, table.nextRetryAt)]);

export const crawlDetails = sqliteTable("crawl_details", {
  namespace: text("namespace").notNull(),
  postingKey: text("posting_key").notNull(),
  revision: text("revision").notNull(),
  payload: text("payload").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [primaryKey({ columns: [table.namespace, table.postingKey] }), index("crawl_details_expiry_idx").on(table.expiresAt)]);
