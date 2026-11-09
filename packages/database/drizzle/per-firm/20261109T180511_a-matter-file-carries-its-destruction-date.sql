-- A MATTER'S PAPER FILE CARRIES THE DATE IT MAY BE DESTROYED.
--
-- The date on or after which the firm may destroy its own paper file for a matter, as a person at
-- the firm recorded it. The platform derives nothing: a retention period is jurisdictional, so the
-- date is the firm's to state, and nothing reads it to delete anything. It is a reminder on the
-- matter's status window and on the firm calendar.
--
-- A table of its own rather than a column on `matter`: a date column carries the shared shape CHECK,
-- and adding a CHECK to `matter` is a rebuild of a table most of the schema points at. Keyed by the
-- matter, so one file has at most one date; clearing the date deletes the row, and the audit log
-- keeps every date the matter carried.
CREATE TABLE `matter_file_retention` (
	`matter_id` text PRIMARY KEY NOT NULL,
	`destroy_on` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_file_retention_destroy_on_shape_check" CHECK("matter_file_retention"."destroy_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `matter_file_retention_destroy_on_matter_id_index` ON `matter_file_retention` (`destroy_on`,`matter_id`);--> statement-breakpoint
-- THE FIRM'S MINIMUM RETENTION GETS AN OWNER. `matters:manageRetention` sets the floor under the
-- date a person states when a matter closes. Owner/Admin alone: the period is the firm's policy,
-- and whoever may close a matter must not thereby be able to shorten how long every file is kept.
-- The house seed shape (see 20260909T000000_seed-ai-settings-permission.sql), which the
-- ungranted-permissions scan reads to prove somebody holds the permission.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_retentionOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:manageRetention');
