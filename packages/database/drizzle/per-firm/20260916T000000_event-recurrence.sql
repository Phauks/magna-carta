-- A SETTING THAT REPEATS IS ONE ROW WITH A RULE, EXPANDED WHEN IT IS READ.
--
-- The alternative — a row per occurrence — multiplies a firm's calendar by the length of its
-- longest series before anybody looks at it, and turns "move the series" into fifty-two writes.
-- The reads expand across the window they were asked for, which the platform already caps at a
-- year, so the work is bounded by what is on screen rather than by how far a rule runs.
--
-- `recurrence_rule` holds an RFC 5545 RRULE ("FREQ=WEEKLY;BYDAY=TU;COUNT=12"), null on a one-off.
-- The standard is stored rather than a private shape because it is the one every calendar product
-- reads and writes, and a firm exporting its calendar should not find this product's dialect in it.
--
-- AN EXCEPTION IS A REAL EVENT THAT KNOWS WHAT IT REPLACES. `recurrence_parent_id` names the
-- series and `recurrence_occurrence_on` the date within it that this row stands in for; the
-- parent's expansion skips that date. So an occurrence moved, renamed or called off is an ordinary
-- row, and every read that already understands an event understands it — including the rule that a
-- cancelled setting stays visible and struck. An exclusion LIST would have needed a second
-- mechanism to say "and this one was cancelled".
--
-- The added columns carry their own CHECK rather than the table being rebuilt: widening or adding a
-- constraint by rebuild drops the table it replaces, and `matter_event` is a parent that
-- `matter_event_participant`, `firm_resource_booking` and `calendar_event_link` reference. An ADDED
-- column may carry a CHECK because it drops nothing — the same mechanism the task-rungs migration
-- proved against real durable-object storage (apps/api-worker/test/durable-object-pragma-context.test.ts).
ALTER TABLE `matter_event` ADD `recurrence_rule` text;--> statement-breakpoint
ALTER TABLE `matter_event` ADD `recurrence_parent_id` text;--> statement-breakpoint
ALTER TABLE `matter_event` ADD `recurrence_occurrence_on` text CHECK ("matter_event"."recurrence_occurrence_on" IS NULL OR "matter_event"."recurrence_occurrence_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');--> statement-breakpoint
CREATE INDEX `matter_event_recurrence_parent_index` ON `matter_event` (`recurrence_parent_id`);--> statement-breakpoint
ALTER TABLE `firm_event` ADD `recurrence_rule` text;--> statement-breakpoint
ALTER TABLE `firm_event` ADD `recurrence_parent_id` text;--> statement-breakpoint
ALTER TABLE `firm_event` ADD `recurrence_occurrence_on` text CHECK ("firm_event"."recurrence_occurrence_on" IS NULL OR "firm_event"."recurrence_occurrence_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');--> statement-breakpoint
CREATE INDEX `firm_event_recurrence_parent_index` ON `firm_event` (`recurrence_parent_id`);
