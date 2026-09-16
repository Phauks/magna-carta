-- A TASK CARRIES ITS PEOPLE BY ROLE, AND A CHECKLIST INSIDE IT.
--
-- The task record held one name — `assignee_user_id` — and the owner's review of the surface said
-- the one name was the wrong shape: a real piece of work has somebody responsible for it, one or
-- more people assigned to do it, sometimes somebody who reviews it, and colleagues who only want to
-- watch it and hear when it moves. So the people move into their own table, one row per person per
-- task with the role they hold, and the one-name column is RETIRED: emptied here, never written
-- again, and kept on the parent because dropping a column is the rebuild a durable object refuses
-- (the cancellation columns beside it stay for the same reason).
--
-- The checklist is the flat to-do list inside a task — lines somebody ticks, in the order they
-- were written. It is not a task tree: a line has no assignee, no date, no priority, and nothing
-- rolls up from it.
--
-- contract: nothing is dropped and nothing is rebuilt. Two tables are created, every assignee the
-- old column names is copied across as an `assigned` participant, and the old column is emptied
-- in the same migration so the two homes for "whose task" never both hold a value. A firm with no
-- assigned task runs the INSERT and the UPDATE and changes nothing.
--
-- The participant handle is derived from the task's own token — the part after `matterTask_` —
-- under the participant prefix. A task holds at most one assignee here, so the derived handle is
-- unique, and it is the same alphabet and length every minted handle has.
CREATE TABLE `matter_task_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text,
	`added_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_participant_role_check" CHECK("matter_task_participant"."role" IN ('responsible', 'assigned', 'reviewer', 'watcher'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_participant_task_user_unique_index` ON `matter_task_participant` (`task_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `matter_task_participant_user_task_index` ON `matter_task_participant` (`user_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `matter_task_checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`done_at` text,
	`done_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_checklist_item_title_check" CHECK(length("matter_task_checklist_item"."title") > 0),
	CONSTRAINT "matter_task_checklist_item_done_shape_check" CHECK(("matter_task_checklist_item"."done_at" IS NULL) = ("matter_task_checklist_item"."done_by" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_task_checklist_item_task_position_index` ON `matter_task_checklist_item` (`task_id`,`position`,`id`);--> statement-breakpoint
INSERT INTO `matter_task_participant` (`id`, `task_id`, `user_id`, `role`, `added_by`, `added_at`)
SELECT 'matterTaskParticipant_' || substr(`id`, length('matterTask_') + 1), `id`, `assignee_user_id`, 'assigned', NULL, `updated_at`
FROM `matter_task`
WHERE `assignee_user_id` IS NOT NULL;--> statement-breakpoint
UPDATE `matter_task` SET `assignee_user_id` = NULL WHERE `assignee_user_id` IS NOT NULL;
