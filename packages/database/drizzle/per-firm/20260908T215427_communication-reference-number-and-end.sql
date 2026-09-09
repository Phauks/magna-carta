CREATE TABLE `communication_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL,
	CONSTRAINT "communication_number_counter_next_value_check" CHECK("communication_number_counter"."next_value" > 0)
);
--> statement-breakpoint
ALTER TABLE `communication` ADD `reference_number` text;--> statement-breakpoint
ALTER TABLE `communication` ADD `ended_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `communication_reference_number_unique_index` ON `communication` (`reference_number`) WHERE "communication"."reference_number" IS NOT NULL;--> statement-breakpoint
WITH numbered AS (
	SELECT
		id,
		substr(occurred_at, 1, 10) AS day,
		ROW_NUMBER() OVER (PARTITION BY substr(occurred_at, 1, 10) ORDER BY occurred_at, id) AS ordinal
	FROM `communication`
)
UPDATE `communication` SET `reference_number` = (
	SELECT numbered.day || '-' || printf('%04d', numbered.ordinal)
	FROM numbered WHERE numbered.id = `communication`.id
);--> statement-breakpoint
INSERT INTO `communication_number_counter` (`scope_key`, `next_value`)
SELECT substr(occurred_at, 1, 10), COUNT(*) + 1 FROM `communication` GROUP BY substr(occurred_at, 1, 10);
