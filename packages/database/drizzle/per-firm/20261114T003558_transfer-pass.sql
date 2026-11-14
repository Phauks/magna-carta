CREATE TABLE `transfer_pass` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_run_id` text NOT NULL,
	`transfer_source_file_id` text NOT NULL,
	`record_kind` text NOT NULL,
	`source_kind` text NOT NULL,
	`rules_json` text NOT NULL,
	`report_object_key` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`failed_at` text,
	`rows_read` integer,
	`created_count` integer,
	`already_linked_count` integer,
	`rejected_count` integer,
	`waiting_count` integer,
	`finding_count` integer,
	`columns_missing_count` integer,
	FOREIGN KEY (`transfer_run_id`) REFERENCES `transfer_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_source_file_id`) REFERENCES `transfer_source_file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_pass_record_kind_check" CHECK("transfer_pass"."record_kind" IN ('person', 'organization', 'matter')),
	CONSTRAINT "transfer_pass_nonempty_check" CHECK(length("transfer_pass"."source_kind") > 0 AND length("transfer_pass"."rules_json") > 0 AND length("transfer_pass"."report_object_key") > 0),
	CONSTRAINT "transfer_pass_ending_check" CHECK(("transfer_pass"."finished_at" IS NULL OR "transfer_pass"."failed_at" IS NULL) AND (("transfer_pass"."finished_at" IS NULL AND "transfer_pass"."failed_at" IS NULL) OR "transfer_pass"."started_at" IS NOT NULL)),
	CONSTRAINT "transfer_pass_counts_check" CHECK(("transfer_pass"."finished_at" IS NULL) = ("transfer_pass"."rows_read" IS NULL) AND ("transfer_pass"."rows_read" IS NULL OR ("transfer_pass"."created_count" IS NOT NULL AND "transfer_pass"."already_linked_count" IS NOT NULL AND "transfer_pass"."rejected_count" IS NOT NULL AND "transfer_pass"."waiting_count" IS NOT NULL AND "transfer_pass"."finding_count" IS NOT NULL AND "transfer_pass"."columns_missing_count" IS NOT NULL AND "transfer_pass"."rows_read" = "transfer_pass"."created_count" + "transfer_pass"."already_linked_count" + "transfer_pass"."rejected_count" + "transfer_pass"."waiting_count")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_pass_report_object_key_unique` ON `transfer_pass` (`report_object_key`);--> statement-breakpoint
CREATE INDEX `transfer_pass_run_requested_index` ON `transfer_pass` (`transfer_run_id`,`requested_at`,`id`);--> statement-breakpoint
-- Bringing records in from the system a firm is leaving is the firm's own act: a pass creates
-- people, organizations and matters in bulk, and a source file holds every client the firm has.
-- Owner/Admin alone, the firm:manageScanPolicy bracket. The plain, unqualified seed shape the
-- fitness scan in tooling/lint-ungranted-permissions reads.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_transferRecordsOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:transferRecords');
