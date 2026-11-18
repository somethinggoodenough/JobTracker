CREATE TABLE `scrape_source_progress` (
	`run_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`started_at` text,
	`finished_at` text,
	`updated_at` text NOT NULL,
	`jobs_total` integer DEFAULT 0 NOT NULL,
	`jobs_processed` integer DEFAULT 0 NOT NULL,
	`jobs_added` integer DEFAULT 0 NOT NULL,
	`jobs_updated` integer DEFAULT 0 NOT NULL,
	`jobs_ignored` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_source_progress_run_source_idx` ON `scrape_source_progress` (`run_id`,`source_id`);