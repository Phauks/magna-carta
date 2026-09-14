ALTER TABLE `matter` ADD `intake_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_intake_number_unique_index` ON `matter` (`intake_number`) WHERE "matter"."intake_number" IS NOT NULL;--> statement-breakpoint
WITH numbered AS (
	SELECT
		id,
		substr(created_at, 1, 4) AS year,
		ROW_NUMBER() OVER (PARTITION BY substr(created_at, 1, 4) ORDER BY created_at, id) AS ordinal
	FROM `matter`
	WHERE status = 'intake'
)
UPDATE `matter` SET `intake_number` = (
	SELECT 'I' || numbered.year || '-' || printf('%04d', numbered.ordinal)
	FROM numbered WHERE numbered.id = `matter`.id
) WHERE id IN (SELECT id FROM numbered);--> statement-breakpoint
INSERT INTO `matter_number_counter` (`scope_key`, `next_value`)
SELECT 'intake/' || substr(created_at, 1, 4), COUNT(*) + 1
FROM `matter` WHERE status = 'intake' GROUP BY substr(created_at, 1, 4)
ON CONFLICT(`scope_key`) DO UPDATE SET `next_value` = max(`next_value`, excluded.`next_value`);
