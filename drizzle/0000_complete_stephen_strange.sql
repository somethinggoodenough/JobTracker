CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`source_external_key` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`canonical_url` text NOT NULL,
	`apply_url` text,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '未注明' NOT NULL,
	`workplace_type` text,
	`employment_type` text,
	`department` text,
	`salary` text,
	`description` text DEFAULT '' NOT NULL,
	`posted_at` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_unique` ON `jobs` (`source_external_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_canonical_url_unique` ON `jobs` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `jobs_posted_at_idx` ON `jobs` (`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company`);--> statement-breakpoint
CREATE INDEX `jobs_source_idx` ON `jobs` (`source_id`);--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`sources_total` integer DEFAULT 0 NOT NULL,
	`sources_succeeded` integer DEFAULT 0 NOT NULL,
	`jobs_seen` integer DEFAULT 0 NOT NULL,
	`jobs_added` integer DEFAULT 0 NOT NULL,
	`jobs_updated` integer DEFAULT 0 NOT NULL,
	`jobs_deleted` integer DEFAULT 0 NOT NULL,
	`error_summary` text
);
--> statement-breakpoint
CREATE INDEX `scrape_runs_started_at_idx` ON `scrape_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`adapter` text DEFAULT 'auto' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_success_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_url_unique` ON `sources` (`url`);