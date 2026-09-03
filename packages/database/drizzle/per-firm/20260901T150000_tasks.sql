-- THE TASK, the files a task points at, and the notification vocabulary that carries one.
--
-- A task is one piece of work with somebody's name on it and a state that says whether the firm
-- still owes it. It is neither of the two dated records this schema already holds: a matter_event is
-- a proceeding with an external reality and a continuance discipline, and a matter_deadline is an
-- obligation to a court or a rule whose whole value is that a missing entry is a malpractice event.
-- A task has an assignee and a completion state, which neither of those has, and nobody continues
-- one, nothing vacates one, and no court knows one exists.
--
-- `matter_id` IS NULLABLE, which is the opposite of the call firm_event made for the firm's own
-- calendar scope, and the departure is deliberate. Read both table comments in
-- packages/database/src/per-firm-schema.ts before copying either. The short version: the calendar
-- split its tables because a firm event and a matter event are read on two different surfaces, and
-- tasks have one surface either way -- "what is on my plate" spans a member's client work and their
-- firm work in one list, and two tables would mean unioning them back together on the read every
-- member makes most often. magnus_conversation is the precedent: an optional matter link on a record
-- whose tenancy root is the firm. The does-not-apply branch the calendar warned about is real and is
-- answered by confining it to one function that every read composes.
--
-- There is NO OVERDUE COLUMN and no place to put one. Overdue is a comparison against now, made
-- where the reader is, through packages/calendar/src/overdue.ts. A nightly per-firm sweep over the
-- most numerous table in the product, to maintain a flag that is stale in exactly the window where
-- it matters, is the machinery this platform declines to build for deadlines and declines harder for
-- tasks.
--
-- THE SECOND HALF OF THIS FILE REBUILDS TWO TABLES, on the pattern
-- 20260807T050000_trust-authorization-policy.sql established. `tasks` joins the notification
-- category vocabulary and `matterTask` its subject kinds, and both are SQLite CHECKs, which cannot
-- be widened in place. `notification_event` is the growing one and the reason this is not free; it
-- is bounded by the firm's retention window (a thirty-day floor, swept nightly), so the copy is over
-- a window's worth of rows rather than the firm's whole history.
--
-- `tasks` is a category of its own and deliberately not folded into `deadlines`. A deadline is what
-- a court or a rule requires of the firm, and its whole value is that a missing entry is a
-- malpractice event; putting "call the client back" in that category is how a member stops reading
-- it. A member sets preferences per category, so the split is also what lets somebody silence their
-- own task bell without silencing the one that says a filing is due.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- contract: notification_event and notification_in_app_suppression are each dropped after their
-- rows are copied into a replacement. Both are same-transaction table REBUILDS, not data removals —
-- each copy is exhaustive (every column, no predicate), the drop and the rename run inside the one
-- migration transaction, and a failure at any point rolls the whole thing back with the original
-- table intact. It is the only way SQLite can widen a CHECK constraint.
--
-- notification_recipient.event_id DOES carry a foreign key to notification_event.id, which is why
-- the file brackets the work in PRAGMA foreign_keys=OFF / ON. That is the standard SQLite rebuild
-- and it is safe here for a specific reason rather than by convention: the copy preserves every id
-- verbatim and the replacement takes the original's name, so every referencing row resolves to the
-- same row it resolved to before. Nothing is re-keyed, so there is no window in which a reference
-- would be repointed or dropped. The suppression tally has no referent at all — it is keyed by
-- member, category and civil date. The two new tables in the first half of this file are ordinary
-- creates and drop nothing.
CREATE TABLE `matter_task` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text,
	`title` text NOT NULL,
	`body` text,
	`assignee_user_id` text,
	`created_by` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_on` text,
	`due_at_time` text,
	`time_zone` text,
	`state` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`completed_by` text,
	`cancelled_at` text,
	`cancelled_by` text,
	`cancellation_reason` text,
	`blocked_by_task_id` text,
	`trigger_event_id` text,
	`deadline_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deadline_id`) REFERENCES `matter_deadline`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_title_check" CHECK(length("matter_task"."title") > 0),
	CONSTRAINT "matter_task_priority_check" CHECK("matter_task"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "matter_task_state_check" CHECK("matter_task"."state" IN ('open', 'done', 'cancelled')),
	CONSTRAINT "matter_task_due_on_shape_check" CHECK("matter_task"."due_on" IS NULL OR "matter_task"."due_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_task_due_at_time_shape_check" CHECK("matter_task"."due_at_time" IS NULL OR "matter_task"."due_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_task_due_shape_check" CHECK(("matter_task"."due_at_time" IS NULL OR "matter_task"."due_on" IS NOT NULL)
        AND ("matter_task"."due_on" IS NULL) = ("matter_task"."time_zone" IS NULL)),
	CONSTRAINT "matter_task_completion_shape_check" CHECK(("matter_task"."state" = 'done' AND "matter_task"."completed_at" IS NOT NULL AND "matter_task"."completed_by" IS NOT NULL)
        OR ("matter_task"."state" != 'done' AND "matter_task"."completed_at" IS NULL AND "matter_task"."completed_by" IS NULL)),
	CONSTRAINT "matter_task_cancellation_shape_check" CHECK(("matter_task"."state" = 'cancelled' AND "matter_task"."cancelled_at" IS NOT NULL AND "matter_task"."cancelled_by" IS NOT NULL
          AND "matter_task"."cancellation_reason" IS NOT NULL AND length("matter_task"."cancellation_reason") > 0)
        OR ("matter_task"."state" != 'cancelled' AND "matter_task"."cancelled_at" IS NULL AND "matter_task"."cancelled_by" IS NULL
          AND "matter_task"."cancellation_reason" IS NULL)),
	CONSTRAINT "matter_task_blocked_by_self_check" CHECK("matter_task"."blocked_by_task_id" != "matter_task"."id")
);
--> statement-breakpoint
CREATE INDEX `matter_task_assignee_state_due_on_index` ON `matter_task` (`assignee_user_id`,`state`,`due_on`);--> statement-breakpoint
CREATE INDEX `matter_task_matter_due_on_id_index` ON `matter_task` (`matter_id`,`due_on`,`id`);--> statement-breakpoint
CREATE INDEX `matter_task_matter_created_at_id_index` ON `matter_task` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_task_created_by_index` ON `matter_task` (`created_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `matter_task_blocked_by_index` ON `matter_task` (`blocked_by_task_id`);--> statement-breakpoint
CREATE INDEX `matter_task_deadline_index` ON `matter_task` (`deadline_id`);--> statement-breakpoint
CREATE TABLE `matter_task_document` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`file_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matter_task_document_task_index` ON `matter_task_document` (`task_id`);--> statement-breakpoint
CREATE INDEX `matter_task_document_file_index` ON `matter_task_document` (`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_document_task_file_unique_index` ON `matter_task_document` (`task_id`,`file_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification_event` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`matter_id` text,
	`occurred_at` text NOT NULL,
	`facts` text,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_event_category_check" CHECK("__new_notification_event"."category" IN ('deadlines', 'calendar', 'tasks', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')),
	CONSTRAINT "notification_event_severity_check" CHECK("__new_notification_event"."severity" IN ('informational', 'attention', 'critical')),
	CONSTRAINT "notification_event_subject_kind_check" CHECK("__new_notification_event"."subject_kind" IN ('matter', 'matterEvent', 'matterDeadline', 'matterAsset', 'invoice', 'ledgerEntry', 'trustMovement', 'file', 'fileVersion', 'documentCheckout', 'directoryEntity', 'location', 'shipment', 'emailMessage', 'emailCaptureAddress', 'custodyPacket', 'custodyItem', 'custodyMovement', 'conflictsCheck', 'incident', 'magnusConversation', 'reviewSet', 'discoveryLoad', 'conversionJob', 'documentAssembly', 'bundleBuild', 'searchIndexJob', 'recoveryJob', 'member', 'matterTask'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_event`("id", "kind", "category", "severity", "subject_kind", "subject_id", "matter_id", "occurred_at", "facts", "dedupe_key", "created_at") SELECT "id", "kind", "category", "severity", "subject_kind", "subject_id", "matter_id", "occurred_at", "facts", "dedupe_key", "created_at" FROM `notification_event`;--> statement-breakpoint
DROP TABLE `notification_event`;--> statement-breakpoint
ALTER TABLE `__new_notification_event` RENAME TO `notification_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_event_dedupe_key_unique_index` ON `notification_event` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_event_matter_id_index` ON `notification_event` (`matter_id`);--> statement-breakpoint
CREATE INDEX `notification_event_occurred_at_index` ON `notification_event` (`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `__new_notification_in_app_suppression` (
	`recipient_user_id` text NOT NULL,
	`category` text NOT NULL,
	`civil_date` text NOT NULL,
	`suppressed_count` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`last_suppressed_at` text NOT NULL,
	PRIMARY KEY(`recipient_user_id`, `category`, `civil_date`, `reason`),
	CONSTRAINT "notification_in_app_suppression_count_nonnegative_check" CHECK("__new_notification_in_app_suppression"."suppressed_count" >= 0),
	CONSTRAINT "notification_in_app_suppression_category_check" CHECK("__new_notification_in_app_suppression"."category" IN ('deadlines', 'calendar', 'tasks', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')),
	CONSTRAINT "notification_in_app_suppression_reason_check" CHECK("__new_notification_in_app_suppression"."reason" IN ('member-preference', 'firm-policy'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_in_app_suppression`("recipient_user_id", "category", "civil_date", "suppressed_count", "reason", "last_suppressed_at") SELECT "recipient_user_id", "category", "civil_date", "suppressed_count", "reason", "last_suppressed_at" FROM `notification_in_app_suppression`;--> statement-breakpoint
DROP TABLE `notification_in_app_suppression`;--> statement-breakpoint
ALTER TABLE `__new_notification_in_app_suppression` RENAME TO `notification_in_app_suppression`;--> statement-breakpoint

-- The three task permissions, seeded onto the default roles.
--
-- tasks:read and tasks:write reach every seat that does firm work -- Owner/Admin, Attorney, Paralegal
-- AND Billing. Billing is the difference from the notes seeds, and it is the point: "chase the
-- Henderson retainer replenishment" is a billing clerk's own work, and a task list that cannot hold
-- it sends them to a spreadsheet. Read-only gets neither, because that seat is frequently an outside
-- accountant or an auditor and the firm's work queue is not part of what they came to see.
--
-- tasks:assign additionally reaches Owner/Admin, Attorney and Paralegal but not Billing. The key
-- exists so a firm CAN reserve who puts work in other people's names; the default is the workable
-- one, because paralegals and attorneys delegate to each other constantly and a default that made
-- them ask an administrator would be routed around on the first day. Withholding it is the firm's
-- deliberate act, never the platform's opening position.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.

INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadBilling00000', 'role_hwwC1D98d8Lazc_asL6vO', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksAssignOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:assign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksAssignAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:assign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksAssignParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'tasks:assign');
