-- A CONFLICTS RUN CAN BE CANCELLED.
--
-- A member may stop a run from the check's screen. The run settles with status 'failed' and these two
-- columns say who stopped it and when; a read reports it as cancelled. A fifth status would mean
-- widening the status CHECK constraint, which SQLite does only by rebuilding the table.
ALTER TABLE `conflicts_check_run` ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE `conflicts_check_run` ADD `cancelled_by_user_id` text;
