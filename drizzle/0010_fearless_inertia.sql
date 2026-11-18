CREATE TABLE `screening_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`coarse_json` text DEFAULT '{}' NOT NULL,
	`ai_prompt` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO screening_settings(id,coarse_json,ai_prompt,version,updated_at)
VALUES(1,'{}',NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
