CREATE TABLE `ai_detection_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_by` text NOT NULL,
	`word_count` integer NOT NULL,
	`mode` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`adapter_id` text NOT NULL,
	`vendor_version` text,
	`result_band` text,
	`matter_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_detection_usage_created_at_index` ON `ai_detection_usage` (`created_at`);
