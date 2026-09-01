-- Tasks join the notification vocabulary: one category and one subject kind.
--
-- Both are SQLite CHECKs, and SQLite cannot widen one in place — so this is a REBUILD of two tables,
-- on the pattern 20260807T050000_trust-authorization-policy.sql established. Each is created under a
-- temporary name, its rows copied, the original dropped, the new one renamed, and every index put
-- back. `notification_event` is the growing one and the reason this is not free; it is bounded by
-- the firm's retention window (a thirty-day floor, swept nightly), so the copy is over a window's
-- worth of rows rather than over the firm's whole history.
--
-- `tasks` is a category of its own and deliberately not folded into `deadlines`. A deadline is what
-- a court or a rule requires of the firm, and its whole value is that a missing entry is a
-- malpractice event; putting "call the client back" in that category is how a member stops reading
-- it. A member sets preferences per category, so the split is also what lets somebody silence their
-- own task bell without silencing the one that says a filing is due.
--
-- `matterTask` is the subject kind. The notification row points AT a task and stores nothing about
-- it: no title, no body, no assignee name. The card is assembled at read time from the kind and a
-- visibility-filtered matter join, which is why nothing here has to carry a task's free text.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
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
ALTER TABLE `__new_notification_in_app_suppression` RENAME TO `notification_in_app_suppression`;