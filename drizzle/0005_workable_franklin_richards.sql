CREATE TABLE `ai_daily_budget` (
	`day` text PRIMARY KEY NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`canonical_url` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`next_retry_at` text NOT NULL,
	`last_error` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_candidates_url_unique` ON `job_candidates` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_candidates_dedupe_unique` ON `job_candidates` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `job_candidates_expiry_idx` ON `job_candidates` (`expires_at`);--> statement-breakpoint
CREATE TABLE `job_discoveries` (
	`identity` text PRIMARY KEY NOT NULL,
	`first_seen_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `jobs_queued` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scrape_source_progress` ADD `jobs_queued` integer DEFAULT 0 NOT NULL;