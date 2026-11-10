-- TASK LISTS, THE FIRM'S OWN STATUSES, TEAMS, AND WHAT A TASK NOW CARRIES.
--
-- A firm keeps several task lists and every task sits on one. Each list has its own statuses, with a
-- colour and a flow, and the first one is where new work starts; completing a task stays the `state`
-- column and works from any status. A task can name several assignees, each a member or a team, and
-- watchers kept informed without doing the work; it gains a start date, a location, a checklist,
-- links, and sub-tasks (a whole task under a parent, sharing its list and matter).
--
-- contract: nothing is dropped, rebuilt or widened. `matter_task` is a parent table a durable object
-- cannot rebuild (packages/database/src/per-firm-schema.ts says why), so its five new facts are
-- ADDED columns, each carrying its own CHECK where it needs one, and everything else is a new table.
--
-- THE EXISTING WORK IS CARRIED, NOT INFERRED. One list is created, "Tasks", marked default, with the
-- three statuses the rungs named and every move between them allowed, so nothing a firm could do
-- yesterday is refused today. Every task is put on it at the status its rung named, and every
-- assignee becomes the task's first assignee row. A firm with no tasks gets the list and nothing else.
CREATE TABLE `task_list` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`retired_at` text,
	CONSTRAINT "task_list_name_nonempty_check" CHECK(length("task_list"."name") > 0),
	CONSTRAINT "task_list_default_live_check" CHECK("task_list"."is_default" = 0 OR "task_list"."retired_at" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_list_name_live_unique_index` ON `task_list` (`name`) WHERE "task_list"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `task_list_default_unique_index` ON `task_list` (`is_default`) WHERE "task_list"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `task_list_status` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'gray' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `task_list`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_list_status_name_nonempty_check" CHECK(length("task_list_status"."name") > 0),
	CONSTRAINT "task_list_status_colour_check" CHECK("task_list_status"."colour" IN ('gray', 'blue', 'orange', 'amber', 'green', 'purple', 'red'))
);
--> statement-breakpoint
CREATE INDEX `task_list_status_list_index` ON `task_list_status` (`list_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_list_status_list_name_unique_index` ON `task_list_status` (`list_id`,`name`);--> statement-breakpoint
CREATE TABLE `task_list_status_transition` (
	`from_status_id` text NOT NULL,
	`to_status_id` text NOT NULL,
	PRIMARY KEY(`from_status_id`, `to_status_id`),
	FOREIGN KEY (`from_status_id`) REFERENCES `task_list_status`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_status_id`) REFERENCES `task_list_status`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_list_status_transition_distinct_check" CHECK("task_list_status_transition"."from_status_id" != "task_list_status_transition"."to_status_id")
);
--> statement-breakpoint
CREATE INDEX `task_list_status_transition_to_index` ON `task_list_status_transition` (`to_status_id`);--> statement-breakpoint
CREATE TABLE `task_team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`retired_at` text,
	CONSTRAINT "task_team_name_nonempty_check" CHECK(length("task_team"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_team_name_live_unique_index` ON `task_team` (`name`) WHERE "task_team"."retired_at" IS NULL;--> statement-breakpoint
CREATE TABLE `task_team_member` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `task_team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_team_member_user_index` ON `task_team_member` (`user_id`);--> statement-breakpoint
CREATE TABLE `matter_task_assignee` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text,
	`team_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` text NOT NULL,
	`added_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `task_team`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_assignee_one_kind_check" CHECK(("matter_task_assignee"."user_id" IS NULL) != ("matter_task_assignee"."team_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_task_assignee_task_index` ON `matter_task_assignee` (`task_id`,`position`);--> statement-breakpoint
CREATE INDEX `matter_task_assignee_user_index` ON `matter_task_assignee` (`user_id`);--> statement-breakpoint
CREATE INDEX `matter_task_assignee_team_index` ON `matter_task_assignee` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_assignee_task_user_unique_index` ON `matter_task_assignee` (`task_id`,`user_id`) WHERE "matter_task_assignee"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_assignee_task_team_unique_index` ON `matter_task_assignee` (`task_id`,`team_id`) WHERE "matter_task_assignee"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `matter_task_watcher` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` text NOT NULL,
	`added_by` text,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_task_watcher_user_index` ON `matter_task_watcher` (`user_id`);--> statement-breakpoint
CREATE TABLE `matter_task_checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`text` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`done_at` text,
	`done_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_checklist_item_text_nonempty_check" CHECK(length("matter_task_checklist_item"."text") > 0),
	CONSTRAINT "matter_task_checklist_item_done_shape_check" CHECK(("matter_task_checklist_item"."done_at" IS NULL) = ("matter_task_checklist_item"."done_by" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_task_checklist_item_task_index` ON `matter_task_checklist_item` (`task_id`,`position`);--> statement-breakpoint
CREATE TABLE `matter_task_link` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`url` text NOT NULL,
	`label` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_link_url_nonempty_check" CHECK(length("matter_task_link"."url") > 0)
);
--> statement-breakpoint
CREATE INDEX `matter_task_link_task_index` ON `matter_task_link` (`task_id`,`position`);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `list_id` text REFERENCES task_list(id);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `status_id` text REFERENCES task_list_status(id);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `parent_task_id` text REFERENCES matter_task(id) CHECK (`parent_task_id` != `id`);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `starts_on` text CHECK (`starts_on` IS NULL OR `starts_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');--> statement-breakpoint
ALTER TABLE `matter_task` ADD `location` text;--> statement-breakpoint
CREATE INDEX `matter_task_list_state_index` ON `matter_task` (`list_id`,`state`);--> statement-breakpoint
CREATE INDEX `matter_task_status_index` ON `matter_task` (`status_id`);--> statement-breakpoint
CREATE INDEX `matter_task_parent_index` ON `matter_task` (`parent_task_id`);--> statement-breakpoint
INSERT INTO `task_list` (`id`, `name`, `position`, `is_default`, `created_at`, `updated_at`) VALUES ('taskList_firmDefaultList000', 'Tasks', 0, 1, '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `task_list_status` (`id`, `list_id`, `name`, `colour`, `position`, `created_at`) VALUES ('taskListStatus_defaultToDo0000', 'taskList_firmDefaultList000', 'To Do', 'gray', 0, '2026-11-09T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `task_list_status` (`id`, `list_id`, `name`, `colour`, `position`, `created_at`) VALUES ('taskListStatus_defaultInProgres', 'taskList_firmDefaultList000', 'In Progress', 'blue', 1, '2026-11-09T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `task_list_status` (`id`, `list_id`, `name`, `colour`, `position`, `created_at`) VALUES ('taskListStatus_defaultOnHold000', 'taskList_firmDefaultList000', 'On Hold', 'amber', 2, '2026-11-09T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `task_list_status_transition` (`from_status_id`, `to_status_id`) VALUES ('taskListStatus_defaultToDo0000', 'taskListStatus_defaultInProgres'), ('taskListStatus_defaultToDo0000', 'taskListStatus_defaultOnHold000'), ('taskListStatus_defaultInProgres', 'taskListStatus_defaultToDo0000'), ('taskListStatus_defaultInProgres', 'taskListStatus_defaultOnHold000'), ('taskListStatus_defaultOnHold000', 'taskListStatus_defaultToDo0000'), ('taskListStatus_defaultOnHold000', 'taskListStatus_defaultInProgres');
--> statement-breakpoint
UPDATE `matter_task`
SET `list_id` = 'taskList_firmDefaultList000',
    `status_id` = CASE `progress`
      WHEN 'in_progress' THEN 'taskListStatus_defaultInProgres'
      WHEN 'on_hold' THEN 'taskListStatus_defaultOnHold000'
      ELSE 'taskListStatus_defaultToDo0000'
    END;
--> statement-breakpoint
INSERT INTO `matter_task_assignee` (`id`, `task_id`, `user_id`, `position`, `added_at`)
SELECT 'matterTaskAssignee_' || substr(`id`, 12), `id`, `assignee_user_id`, 0, `created_at`
FROM `matter_task`
WHERE `assignee_user_id` IS NOT NULL;
