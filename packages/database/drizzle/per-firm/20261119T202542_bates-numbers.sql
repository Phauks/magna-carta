CREATE TABLE `bates_range` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`prefix` text NOT NULL,
	`digits` integer NOT NULL,
	`first_number` integer NOT NULL,
	`last_number` integer NOT NULL,
	`purpose` text NOT NULL,
	`source_file_id` text,
	`exhibit_set_id` text,
	`stamped_file_id` text,
	`stamped_file_saved_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exhibit_set_id`) REFERENCES `exhibit_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stamped_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bates_range_purpose_check" CHECK("bates_range"."purpose" IN ('pdfEditor', 'exhibitPackage')),
	CONSTRAINT "bates_range_numbers_check" CHECK("bates_range"."first_number" >= 0 AND "bates_range"."last_number" >= "bates_range"."first_number"),
	CONSTRAINT "bates_range_digits_check" CHECK("bates_range"."digits" BETWEEN 1 AND 12),
	CONSTRAINT "bates_range_prefix_length_check" CHECK(length("bates_range"."prefix") <= 40),
	CONSTRAINT "bates_range_saved_shape_check" CHECK(("bates_range"."stamped_file_id" IS NULL) = ("bates_range"."stamped_file_saved_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bates_range_matter_prefix_first_unique_index` ON `bates_range` (`matter_id`,`prefix`,`first_number`);--> statement-breakpoint
CREATE INDEX `bates_range_matter_created_index` ON `bates_range` (`matter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bates_range_source_file_index` ON `bates_range` (`source_file_id`);--> statement-breakpoint
CREATE INDEX `bates_range_stamped_file_index` ON `bates_range` (`stamped_file_id`);--> statement-breakpoint
CREATE INDEX `bates_range_exhibit_set_index` ON `bates_range` (`exhibit_set_id`);--> statement-breakpoint
-- A range is the record of numbers a stamp took. It is never deleted and its numbers never change,
-- so a number once stamped is never handed out again. The stamped copy is recorded once.
CREATE TRIGGER `bates_range_no_delete` BEFORE DELETE ON `bates_range`
BEGIN
	SELECT RAISE(ABORT, 'bates_range is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `bates_range_numbers_fixed` BEFORE UPDATE OF `matter_id`, `prefix`, `digits`, `first_number`, `last_number`, `purpose`, `source_file_id`, `exhibit_set_id`, `created_by`, `created_at` ON `bates_range`
BEGIN
	SELECT RAISE(ABORT, 'bates_range numbers are fixed once taken');
END;--> statement-breakpoint
CREATE TRIGGER `bates_range_stamped_file_once` BEFORE UPDATE OF `stamped_file_id`, `stamped_file_saved_at` ON `bates_range`
WHEN OLD.`stamped_file_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'bates_range stamped copy is already recorded');
END;
