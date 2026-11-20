CREATE TABLE `bates_log` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`digits` integer NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bates_log_name_length_check" CHECK(length("bates_log"."name") BETWEEN 1 AND 120),
	CONSTRAINT "bates_log_digits_check" CHECK("bates_log"."digits" BETWEEN 1 AND 12),
	CONSTRAINT "bates_log_prefix_length_check" CHECK(length("bates_log"."prefix") <= 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bates_log_matter_name_unique_index` ON `bates_log` (`matter_id`,`name`);--> statement-breakpoint
DROP INDEX `bates_range_matter_prefix_first_unique_index`;--> statement-breakpoint
ALTER TABLE `bates_range` ADD `log_id` text REFERENCES bates_log(id);--> statement-breakpoint
CREATE UNIQUE INDEX `bates_range_log_first_unique_index` ON `bates_range` (`log_id`,`first_number`);--> statement-breakpoint
-- The numbers stamped before a matter could keep several logs each go into a log of their own, one
-- per matter and prefix, named for the prefix, so every count carries on where it stopped.
INSERT INTO `bates_log` (`id`, `matter_id`, `name`, `prefix`, `digits`, `created_by`, `created_at`)
SELECT 'batesLog_' || substr(hex(randomblob(11)), 1, 21), `g`.`matter_id`,
	CASE WHEN `g`.`prefix` = '' THEN 'Bates Numbers' ELSE `g`.`prefix` END, `g`.`prefix`,
	(SELECT `r`.`digits` FROM `bates_range` `r` WHERE `r`.`matter_id` = `g`.`matter_id` AND `r`.`prefix` = `g`.`prefix` ORDER BY `r`.`last_number` DESC LIMIT 1),
	NULL, MIN(`g`.`created_at`)
FROM `bates_range` `g` GROUP BY `g`.`matter_id`, `g`.`prefix`;--> statement-breakpoint
UPDATE `bates_range` SET `log_id` = (SELECT `l`.`id` FROM `bates_log` `l` WHERE `l`.`matter_id` = `bates_range`.`matter_id` AND `l`.`prefix` = `bates_range`.`prefix`) WHERE `log_id` IS NULL;--> statement-breakpoint
-- A range's log is as fixed as its numbers.
DROP TRIGGER `bates_range_numbers_fixed`;--> statement-breakpoint
CREATE TRIGGER `bates_range_numbers_fixed` BEFORE UPDATE OF `matter_id`, `log_id`, `prefix`, `digits`, `first_number`, `last_number`, `purpose`, `source_file_id`, `exhibit_set_id`, `created_by`, `created_at` ON `bates_range`
BEGIN
	SELECT RAISE(ABORT, 'bates_range numbers are fixed once taken');
END;--> statement-breakpoint
-- A log's prefix and padding are what its stamps printed, so they never change; only its name may.
-- A log is never deleted, so its numbers stay on record.
CREATE TRIGGER `bates_log_fixed` BEFORE UPDATE OF `matter_id`, `prefix`, `digits`, `created_by`, `created_at` ON `bates_log`
BEGIN
	SELECT RAISE(ABORT, 'bates_log prefix and digits are fixed');
END;--> statement-breakpoint
CREATE TRIGGER `bates_log_no_delete` BEFORE DELETE ON `bates_log`
BEGIN
	SELECT RAISE(ABORT, 'bates_log is never deleted');
END;
