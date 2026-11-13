CREATE TABLE `source_record_link` (
	`source_system` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`local_table` text NOT NULL,
	`local_id` text NOT NULL,
	`transfer_run_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`source_system`, `source_kind`, `source_id`, `local_table`),
	FOREIGN KEY (`transfer_run_id`) REFERENCES `transfer_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_record_link_source_system_shape_check" CHECK(length("source_record_link"."source_system") > 0 AND "source_record_link"."source_system" = lower(trim("source_record_link"."source_system"))),
	CONSTRAINT "source_record_link_nonempty_check" CHECK(length("source_record_link"."source_kind") > 0 AND length("source_record_link"."source_id") > 0 AND length("source_record_link"."local_table") > 0 AND length("source_record_link"."local_id") > 0)
);
--> statement-breakpoint
CREATE INDEX `source_record_link_local_index` ON `source_record_link` (`local_table`,`local_id`);--> statement-breakpoint
CREATE INDEX `source_record_link_transfer_run_index` ON `source_record_link` (`transfer_run_id`);--> statement-breakpoint
CREATE TABLE `transfer_run` (
	`id` text PRIMARY KEY NOT NULL,
	`source_system` text NOT NULL,
	`label` text NOT NULL,
	`started_by` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`abandoned_at` text,
	FOREIGN KEY (`started_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_run_source_system_shape_check" CHECK(length("transfer_run"."source_system") > 0 AND "transfer_run"."source_system" = lower(trim("transfer_run"."source_system"))),
	CONSTRAINT "transfer_run_label_nonempty_check" CHECK(length(trim("transfer_run"."label")) > 0),
	CONSTRAINT "transfer_run_single_ending_check" CHECK("transfer_run"."completed_at" IS NULL OR "transfer_run"."abandoned_at" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `transfer_run_source_system_index` ON `transfer_run` (`source_system`,`started_at`);