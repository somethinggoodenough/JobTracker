CREATE TABLE `crawl_details` (
	`namespace` text NOT NULL,
	`posting_key` text NOT NULL,
	`revision` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`namespace`, `posting_key`)
);
--> statement-breakpoint
CREATE INDEX `crawl_details_expiry_idx` ON `crawl_details` (`expires_at`);--> statement-breakpoint
ALTER TABLE `job_candidates` ADD `claim_run_id` integer;--> statement-breakpoint
CREATE INDEX `job_candidates_ready_idx` ON `job_candidates` (`claim_run_id`,`next_retry_at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `crawl_hash` text;--> statement-breakpoint
ALTER TABLE `scrape_source_progress` ADD `metrics_json` text;