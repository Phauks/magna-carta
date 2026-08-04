CREATE TABLE `index_split` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`object_key` text NOT NULL,
	`document_count` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`schema_generation` integer NOT NULL,
	`created_at` text NOT NULL,
	`superseded_at` text
);
--> statement-breakpoint
CREATE INDEX `index_split_matter_superseded_index` ON `index_split` (`matter_id`,`superseded_at`);
