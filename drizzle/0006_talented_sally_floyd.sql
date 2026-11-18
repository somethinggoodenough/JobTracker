CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`daily_limit` integer DEFAULT 100,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `ai_settings` (`id`,`daily_limit`,`updated_at`) VALUES (1,100,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `ai_rule_rejected` integer;--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `ai_cache_hits` integer;--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `ai_requests` integer;
