CREATE TABLE `planner_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`entry_id` integer,
	`project_id` integer NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`interval_days` integer DEFAULT 1 NOT NULL,
	`due_on` text NOT NULL,
	`last_result` text,
	FOREIGN KEY (`entry_id`) REFERENCES `planner_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `planner_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planner_cards_due_idx` ON `planner_cards` (`due_on`,`project_id`);--> statement-breakpoint
CREATE TABLE `planner_days` (
	`day` text PRIMARY KEY NOT NULL,
	`available_minutes` integer,
	`focus_task_ids` text DEFAULT '[]' NOT NULL,
	`started_at` text,
	`closed_at` text,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planner_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`project_id` integer,
	`task_id` integer,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`metric` text,
	`cause` text,
	`resume_candidate` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `planner_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `planner_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `planner_entries_project_idx` ON `planner_entries` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `planner_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`title` text NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`weekly_target_minutes` integer,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planner_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`done_criteria` text DEFAULT '' NOT NULL,
	`target_on` text,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`done_at` text,
	`source_ref` text,
	FOREIGN KEY (`project_id`) REFERENCES `planner_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planner_milestones_project_idx` ON `planner_milestones` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `planner_milestones_source_idx` ON `planner_milestones` (`project_id`,`source_ref`);--> statement-breakpoint
CREATE TABLE `planner_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`goal_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`repo_path` text,
	`last_activity_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `planner_goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `planner_projects_goal_idx` ON `planner_projects` (`goal_id`);--> statement-breakpoint
CREATE TABLE `planner_reviews` (
	`week` text PRIMARY KEY NOT NULL,
	`completed_at` text,
	`notes` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planner_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_active_projects` integer DEFAULT 3,
	`max_doing_tasks` integer DEFAULT 2,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planner_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`project_id` integer NOT NULL,
	`milestone_id` integer,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'next' NOT NULL,
	`due_on` text,
	`estimate_minutes` integer,
	`actual_minutes` integer,
	`blocked_reason` text,
	`check_back_on` text,
	`unblocked_at` text,
	`rollover_count` integer DEFAULT 0 NOT NULL,
	`delay_reason` text,
	`source_ref` text,
	`position` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`done_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `planner_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `planner_milestones`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `planner_tasks_project_idx` ON `planner_tasks` (`project_id`,`milestone_id`,`position`);--> statement-breakpoint
CREATE INDEX `planner_tasks_status_idx` ON `planner_tasks` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `planner_tasks_source_idx` ON `planner_tasks` (`project_id`,`source_ref`);--> statement-breakpoint
CREATE TABLE `source_postings` (
	`source_id` integer NOT NULL,
	`posting_key` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_position` integer NOT NULL,
	`first_run_id` integer,
	PRIMARY KEY(`source_id`, `posting_key`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_postings_seen_idx` ON `source_postings` (`source_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`crawled_at` text NOT NULL,
	`observed_count` integer NOT NULL,
	`scan_complete` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_snapshots_time_idx` ON `source_snapshots` (`source_id`,`crawled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_run_idx` ON `source_snapshots` (`source_id`,`run_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `freshness` text DEFAULT 'uncertain' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `freshness_reason` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `appeared_after` text;
--> statement-breakpoint
UPDATE jobs SET freshness=CASE WHEN publication_verified=1 THEN 'published' ELSE 'uncertain' END,freshness_reason='legacy_pending';
