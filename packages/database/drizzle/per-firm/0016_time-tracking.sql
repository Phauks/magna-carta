CREATE TABLE `narrative_template` (
	`id` text PRIMARY KEY NOT NULL,
	`utbms_task_code_id` text,
	`narrative_template` text NOT NULL,
	`default_rate_e4` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`utbms_task_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `narrative_template_utbms_task_code_index` ON `narrative_template` (`utbms_task_code_id`);--> statement-breakpoint
CREATE TABLE `non_billable_category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "non_billable_category_name_nonempty_check" CHECK(length("non_billable_category"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE `rate` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_card_id` text NOT NULL,
	`tier` text NOT NULL,
	`scoped_id` text,
	`rate_e4` integer NOT NULL,
	`currency` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rate_card_id`) REFERENCES `rate_card`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rate_tier_check" CHECK("rate"."tier" IN ('matter', 'client', 'timekeeper', 'role')),
	CONSTRAINT "rate_currency_check" CHECK("rate"."currency" IN ('USD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_open_row_unique_index` ON `rate` (`rate_card_id`,`tier`,`scoped_id`) WHERE "rate"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX `rate_resolution_index` ON `rate` (`rate_card_id`,`tier`,`scoped_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `rate_card` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "rate_card_name_nonempty_check" CHECK(length("rate_card"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE `time_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`timekeeper_user_id` text NOT NULL,
	`work_date` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`raw_duration_minutes` integer NOT NULL,
	`narrative` text NOT NULL,
	`billable` integer NOT NULL,
	`non_billable_category_id` text,
	`currency` text NOT NULL,
	`rate_e4` integer,
	`rate_card_id` text,
	`rate_source` text,
	`amount_minor` integer,
	`utbms_task_code_id` text,
	`utbms_activity_code_id` text,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`live_run_id` text,
	`invoice_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`timekeeper_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`non_billable_category_id`) REFERENCES `non_billable_category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_card_id`) REFERENCES `rate_card`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utbms_task_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utbms_activity_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_entry_billable_check" CHECK("time_entry"."billable" IN (0, 1)),
	CONSTRAINT "time_entry_status_check" CHECK("time_entry"."status" IN ('draft', 'submitted', 'approved', 'billed', 'void')),
	CONSTRAINT "time_entry_source_check" CHECK("time_entry"."source" IN ('timer', 'manual', 'quick_add', 'grid', 'offline_sync', 'calendar')),
	CONSTRAINT "time_entry_rate_source_check" CHECK("time_entry"."rate_source" IS NULL OR "time_entry"."rate_source" IN ('override', 'matter', 'client', 'timekeeper', 'role', 'card_default')),
	CONSTRAINT "time_entry_currency_check" CHECK("time_entry"."currency" IN ('USD')),
	CONSTRAINT "time_entry_amount_paired_null_check" CHECK((`amount_minor` IS NULL) = (`rate_e4` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `time_entry_timekeeper_work_date_index` ON `time_entry` (`timekeeper_user_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `time_entry_matter_status_index` ON `time_entry` (`matter_id`,`status`);--> statement-breakpoint
CREATE INDEX `time_entry_status_work_date_index` ON `time_entry` (`status`,`work_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_live_run_id_unique_index` ON `time_entry` (`live_run_id`) WHERE "time_entry"."live_run_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `utbms_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code_set` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`practice_area` text,
	`active` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "utbms_code_set_check" CHECK("utbms_code"."code_set" IN ('task', 'activity', 'expense')),
	CONSTRAINT "utbms_code_active_check" CHECK("utbms_code"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `utbms_code_code_set_code_unique` ON `utbms_code` (`code_set`,`code`);--> statement-breakpoint
-- HAND-CORRECTED: PRAGMA foreign_keys=OFF/ON is not in D1's compatible-PRAGMA set.
-- PRAGMA defer_foreign_keys = on defers FK enforcement to the end of the migration batch
-- (one transaction), by which time `matter` exists again under its new definition.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_matter` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`matter_type_id` text,
	`location_id` text,
	`responsible_member_id` text NOT NULL,
	`client_display_name` text,
	`client_code` text,
	`e_billing` integer DEFAULT 0 NOT NULL,
	`matter_number` text,
	`numbered_at` text,
	`opened_at` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_status_check" CHECK("__new_matter"."status" IN ('prospective', 'open', 'closed')),
	CONSTRAINT "matter_title_nonempty_check" CHECK(length("__new_matter"."title") > 0),
	CONSTRAINT "matter_e_billing_check" CHECK("__new_matter"."e_billing" IN (0, 1))
);
--> statement-breakpoint
-- HAND-CORRECTED: old `matter` table does not have e_billing; supply the default (0 = off)
-- rather than selecting a non-existent column. All existing matters start with e_billing off.
INSERT INTO `__new_matter`("id", "title", "description", "status", "matter_type_id", "location_id", "responsible_member_id", "client_display_name", "client_code", "e_billing", "matter_number", "numbered_at", "opened_at", "closed_at", "created_at", "updated_at") SELECT "id", "title", "description", "status", "matter_type_id", "location_id", "responsible_member_id", "client_display_name", "client_code", 0, "matter_number", "numbered_at", "opened_at", "closed_at", "created_at", "updated_at" FROM `matter`;--> statement-breakpoint
DROP TABLE `matter`;--> statement-breakpoint
ALTER TABLE `__new_matter` RENAME TO `matter`;--> statement-breakpoint
CREATE UNIQUE INDEX `matter_matter_number_unique_index` ON `matter` (`matter_number`) WHERE "matter"."matter_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `matter_status_index` ON `matter` (`status`);--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_created_at_id_index` ON `matter` (`responsible_member_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_created_at_id_index` ON `matter` (`created_at`,`id`);
--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE `scoped_setting` (
	`key` text NOT NULL,
	`scope_tier` text NOT NULL,
	`scoped_id` text,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "scoped_setting_scope_tier_check" CHECK(`scope_tier` IN ('matter', 'client', 'user', 'location', 'firm')),
	PRIMARY KEY(`key`, `scope_tier`, `scoped_id`)
);
--> statement-breakpoint
-- Seed the six time: permissions onto the Owner/Admin role. The role_id is the single combined
-- Owner/Admin role seeded in the member-rbac migration; the rolePermission_ handles were minted
-- once and committed as literals so every firm's defaults match byte-for-byte.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES
	('rolePermission_time1TrackOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:track'),
	('rolePermission_time2ViewFirmOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:viewFirm'),
	('rolePermission_time3ApproveOwnerAdmn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:approve'),
	('rolePermission_time4RatesOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageRates'),
	('rolePermission_time5UtbmsOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageUtbms'),
	('rolePermission_time6SettingsOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageSettings');