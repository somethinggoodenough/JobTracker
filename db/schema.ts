import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  errorSummary: text("error_summary"),
}, (table) => [index("scrape_runs_started_at_idx").on(table.startedAt)]);
