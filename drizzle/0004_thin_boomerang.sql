CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_created_at_idx` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE TABLE `job_evaluations` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`decision_json` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_evaluations_expiry_idx` ON `job_evaluations` (`expires_at`);--> statement-breakpoint
ALTER TABLE `applications` ADD `ai_analysis` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ai_policy` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ai_analysis` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ai_model` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ai_reviewed_at` text;