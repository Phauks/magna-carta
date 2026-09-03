-- WHAT AN OUTSIDE SYSTEM NEEDS FROM A TASK, and none of it is a vendor.
--
-- This platform integrates with nothing here and ships no adapter. What it ships is the seam an
-- ADDON writes through, and every part of it is additive and generic: `system` is open text with a
-- non-empty CHECK, the way directory_edge.edge_type is, so a second system is an addon rather than
-- a reviewed migration in this file.
--
-- FOUR THINGS, each of which is cheap now and cannot be reconstructed later.
--
-- matter_task_external_link remembers that a task IS some object over there. Two uniqueness rules,
-- and they are different claims: one remote object maps to at most one task (or two tasks fight
-- over one mirror and each wins half the time), and one task holds at most one identity per system
-- (or a change here has two places to go and no way to choose). Both are indexes rather than
-- service checks, because a race between two syncs is the case a service check loses.
--
-- matter_task_deletion is the tombstone. A task DELETE removes the row, which is right for a record
-- that should not exist -- and it makes the deletion unobservable to anything that was not watching
-- at that moment. A mirror that never learns of it keeps the work alive somewhere the firm stopped
-- looking. The tombstone carries IDENTIFIERS AND NOTHING ELSE: no title, no body, no assignee,
-- because a tombstone preserving the content would defeat the delete it records. task_id is
-- deliberately not a foreign key -- the row it names is gone, which is the point.
--
-- matter_task.updated_by says who touched it last. A system syncing both ways has to tell its own
-- writes from a person's or it pushes back what it just pulled and the two sides oscillate. Null on
-- every row that predates this column: an honest gap, never a backfilled guess.
--
-- The (updated_at, id) index is the change feed's cursor. The instant alone is not one, because two
-- tasks written in the same millisecond would make a page boundary either skip one or repeat it.

CREATE TABLE `matter_task_deletion` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`matter_id` text,
	`deleted_at` text NOT NULL,
	`deleted_by` text
);
--> statement-breakpoint
CREATE INDEX `matter_task_deletion_deleted_at_id_index` ON `matter_task_deletion` (`deleted_at`,`id`);--> statement-breakpoint
CREATE TABLE `matter_task_external_link` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`system` text NOT NULL,
	`external_id` text NOT NULL,
	`external_url` text,
	`remote_revision` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_external_link_system_nonempty_check" CHECK(length("matter_task_external_link"."system") > 0),
	CONSTRAINT "matter_task_external_link_external_id_nonempty_check" CHECK(length("matter_task_external_link"."external_id") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_external_link_system_external_id_unique_index` ON `matter_task_external_link` (`system`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_external_link_task_system_unique_index` ON `matter_task_external_link` (`task_id`,`system`);--> statement-breakpoint
CREATE INDEX `matter_task_external_link_task_index` ON `matter_task_external_link` (`task_id`);--> statement-breakpoint
ALTER TABLE `matter_task` ADD `updated_by` text;--> statement-breakpoint
CREATE INDEX `matter_task_updated_at_id_index` ON `matter_task` (`updated_at`,`id`);