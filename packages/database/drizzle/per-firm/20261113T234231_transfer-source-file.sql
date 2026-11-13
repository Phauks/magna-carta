CREATE TABLE `transfer_source_file` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_run_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`format` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`content_sha256` text NOT NULL,
	`key_column` text,
	`row_count` integer,
	`registered_at` text NOT NULL,
	`read_at` text,
	`removed_at` text,
	FOREIGN KEY (`transfer_run_id`) REFERENCES `transfer_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_source_file_slug_shape_check" CHECK(length("transfer_source_file"."source_kind") > 0 AND "transfer_source_file"."source_kind" = lower(trim("transfer_source_file"."source_kind")) AND length("transfer_source_file"."format") > 0 AND "transfer_source_file"."format" = lower(trim("transfer_source_file"."format"))),
	CONSTRAINT "transfer_source_file_nonempty_check" CHECK(length(trim("transfer_source_file"."file_name")) > 0 AND length("transfer_source_file"."object_key") > 0 AND ("transfer_source_file"."key_column" IS NULL OR length("transfer_source_file"."key_column") > 0)),
	CONSTRAINT "transfer_source_file_byte_length_check" CHECK("transfer_source_file"."byte_length" >= 0),
	CONSTRAINT "transfer_source_file_content_sha256_shape_check" CHECK(length("transfer_source_file"."content_sha256") = 64 AND "transfer_source_file"."content_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "transfer_source_file_read_together_check" CHECK(("transfer_source_file"."row_count" IS NULL) = ("transfer_source_file"."read_at" IS NULL) AND ("transfer_source_file"."row_count" IS NULL OR "transfer_source_file"."row_count" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_source_file_object_key_unique` ON `transfer_source_file` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_source_file_run_content_unique` ON `transfer_source_file` (`transfer_run_id`,`content_sha256`);