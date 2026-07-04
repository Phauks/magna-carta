CREATE TABLE `file_repair_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`file_version_id` text NOT NULL,
	`operation` text NOT NULL,
	`fully_recovered` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`source_media_type` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_repair_provenance_version_index` ON `file_repair_provenance` (`file_version_id`);
