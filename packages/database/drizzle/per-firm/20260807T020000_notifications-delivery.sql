-- Notifications — the delivery half. Five tables, created parent-first so a reader can follow the
-- references down the page, plus the read capability seeded onto every default role.
--
-- notification_recipient carries TWO composite indexes rather than one, and that is deliberate: the
-- state-filtered feed and the unread count lead with (recipient_user_id, state), while the DEFAULT
-- feed — no state filter, the read the bell opens on — cannot use that index for ordering because
-- `state` sits between the equality column and the (created_at, id) keyset pair. Without the second
-- index SQLite sorts the member's entire retained history into a temp B-tree on every page.
--
-- The statement ORDER is the only hand-authored departure from what drizzle-kit emits (it sorts
-- tables alphabetically, which would create the delivery row's table before the recipient row it
-- references). The permission seeds are hand-appended for the same reason every other seed is:
-- drizzle-kit does not emit data.
--
-- notifications:read reaches EVERY default role including Read-only, which is the deliberate
-- contrast with trust:read's exclusion of that seat. A member reading their own feed is not a
-- privilege — the read is scoped to the session's own user id and filtered by matter visibility, so
-- the capability grants sight of nothing the member could not already reach — and a firm whose
-- staff cannot see their own deadlines is a firm the feature has failed.
CREATE TABLE `notification_event` (
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
	CONSTRAINT "notification_event_category_check" CHECK("notification_event"."category" IN ('deadlines', 'calendar', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')),
	CONSTRAINT "notification_event_severity_check" CHECK("notification_event"."severity" IN ('informational', 'attention', 'critical')),
	CONSTRAINT "notification_event_subject_kind_check" CHECK("notification_event"."subject_kind" IN ('matter', 'matterEvent', 'matterDeadline', 'matterAsset', 'invoice', 'ledgerEntry', 'trustMovement', 'file', 'fileVersion', 'documentCheckout', 'directoryEntity', 'location', 'shipment', 'emailMessage', 'emailCaptureAddress', 'custodyPacket', 'custodyItem', 'custodyMovement', 'conflictsCheck', 'incident', 'magnusConversation', 'reviewSet', 'discoveryLoad', 'conversionJob', 'documentAssembly', 'bundleBuild', 'searchIndexJob', 'recoveryJob', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_event_dedupe_key_unique_index` ON `notification_event` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_event_matter_id_index` ON `notification_event` (`matter_id`);--> statement-breakpoint
CREATE INDEX `notification_event_occurred_at_index` ON `notification_event` (`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `notification_recipient` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_event_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`state` text DEFAULT 'unread' NOT NULL,
	`read_at` text,
	`dismissed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notification_event_id`) REFERENCES `notification_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_recipient_state_check" CHECK("notification_recipient"."state" IN ('unread', 'read', 'dismissed')),
	CONSTRAINT "notification_recipient_read_at_check" CHECK(("notification_recipient"."state" = 'read') = ("notification_recipient"."read_at" IS NOT NULL)),
	CONSTRAINT "notification_recipient_dismissed_at_check" CHECK(("notification_recipient"."state" = 'dismissed') = ("notification_recipient"."dismissed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_recipient_event_user_unique_index` ON `notification_recipient` (`notification_event_id`,`recipient_user_id`);--> statement-breakpoint
CREATE INDEX `notification_recipient_user_state_created_index` ON `notification_recipient` (`recipient_user_id`,`state`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notification_recipient_user_created_index` ON `notification_recipient` (`recipient_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_recipient_id` text NOT NULL,
	`channel` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`suppressed_reason` text,
	`digest_id` text,
	`dispatched_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notification_recipient_id`) REFERENCES `notification_recipient`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_delivery_suppressed_reason_check" CHECK(("notification_delivery"."state" = 'suppressed') = ("notification_delivery"."suppressed_reason" IS NOT NULL)),
	CONSTRAINT "notification_delivery_attempts_nonnegative_check" CHECK("notification_delivery"."attempts" >= 0),
	CONSTRAINT "notification_delivery_channel_check" CHECK("notification_delivery"."channel" IN ('in_app', 'email', 'push', 'sms', 'desktop')),
	CONSTRAINT "notification_delivery_state_check" CHECK("notification_delivery"."state" IN ('pending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "notification_delivery_suppressed_reason_value_check" CHECK("notification_delivery"."suppressed_reason" IS NULL OR "notification_delivery"."suppressed_reason" IN ('preference', 'not-visible', 'no-address', 'policy'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_recipient_channel_unique_index` ON `notification_delivery` (`notification_recipient_id`,`channel`);--> statement-breakpoint
CREATE INDEX `notification_delivery_state_index` ON `notification_delivery` (`state`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `notification_digest_run` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`cadence` text NOT NULL,
	`last_occurred_at` text,
	`last_event_id` text,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "notification_digest_run_cadence_check" CHECK("notification_digest_run"."cadence" IN ('daily', 'weekly')),
	CONSTRAINT "notification_digest_run_watermark_pair_check" CHECK(("notification_digest_run"."last_occurred_at" IS NULL) = ("notification_digest_run"."last_event_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_digest_run_user_cadence_unique_index` ON `notification_digest_run` (`recipient_user_id`,`cadence`);--> statement-breakpoint
CREATE TABLE `notification_swept_unread` (
	`recipient_user_id` text PRIMARY KEY NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`oldest_swept_occurred_at` text,
	`last_swept_at` text NOT NULL,
	CONSTRAINT "notification_swept_unread_count_nonnegative_check" CHECK("notification_swept_unread"."unread_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'notifications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'notifications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'notifications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'notifications:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadReadOnly00', 'role_WojF9F7kksBEftsmZGNhb', 'notifications:read');
