CREATE TABLE `crawl_provider_cooldowns` (
	`provider` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`retry_after` text,
	`retry_at` integer NOT NULL
);
