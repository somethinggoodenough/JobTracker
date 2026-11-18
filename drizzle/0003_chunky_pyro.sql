CREATE TABLE `application_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`status` text NOT NULL,
	`reached_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_events_application_idx` ON `application_events` (`application_id`,`id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_job_id` integer NOT NULL,
	`job_key` text NOT NULL,
	`canonical_url` text NOT NULL,
	`apply_url` text,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text NOT NULL,
	`description` text NOT NULL,
	`source_name` text NOT NULL,
	`resume` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`applied_at` text,
	`status` text DEFAULT 'saved' NOT NULL,
	`status_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mutation_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job_key_unique` ON `applications` (`job_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_canonical_url_unique` ON `applications` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `applications_updated_at_idx` ON `applications` (`updated_at`);