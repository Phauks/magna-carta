CREATE TABLE `error_record` (
	`id` text PRIMARY KEY NOT NULL,
	`recorded_at` text NOT NULL,
	`source` text NOT NULL,
	`service` text,
	`operation` text,
	`status` integer,
	`problem_type` text,
	`title` text,
	`error_name` text,
	`message_head` text,
	`location` text,
	`build` text,
	`firm_id` text,
	`user_id` text,
	`correlation_id` text
);
--> statement-breakpoint
CREATE INDEX `error_record_recorded_at_index` ON `error_record` (`recorded_at`);