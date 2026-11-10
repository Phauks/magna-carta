-- A task may repeat. Only the current copy is a row; the next is written when it is due to appear.
-- Added columns rather than a rebuild: matter_task is a parent table, and an added column may carry
-- its own CHECK, including one naming the columns added before it.
ALTER TABLE `matter_task` ADD `recurrence_rule` text;--> statement-breakpoint
ALTER TABLE `matter_task` ADD `recurrence_mode` text CHECK (`recurrence_mode` IS NULL OR `recurrence_mode` IN ('completed', 'scheduled'));--> statement-breakpoint
ALTER TABLE `matter_task` ADD `recurrence_occurrence_on` text CHECK ((`recurrence_occurrence_on` IS NULL OR `recurrence_occurrence_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') AND (`recurrence_rule` IS NULL) = (`recurrence_mode` IS NULL) AND (`recurrence_rule` IS NULL) = (`recurrence_occurrence_on` IS NULL));--> statement-breakpoint
ALTER TABLE `matter_task` ADD `recurrence_next_task_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_recurrence_next_task_unique_index` ON `matter_task` (`recurrence_next_task_id`);--> statement-breakpoint
CREATE INDEX `matter_task_recurrence_mode_index` ON `matter_task` (`recurrence_mode`,`recurrence_next_task_id`);
