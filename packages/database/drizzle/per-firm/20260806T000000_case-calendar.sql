-- The case calendar: the two recorded tables that hold facts born here (a litigation event and a
-- deadline), the event-type catalog and participant table beside them, the office time-zone column,
-- and the two composite indexes the federated timeline reads other subsystems' tables through.
--
-- Nothing here projects, copies, or backfills another subsystem's rows: what the firm already
-- recorded is read in place. The two index additions at the foot are what make those in-place reads
-- index walks rather than scans.
--
-- Hand-ordered rather than left as drizzle-kit emitted it: matter_deadline references matter_event,
-- so the tables are created parent-first, and the platform catalog seed and the permission seed are
-- appended (drizzle-kit expresses neither).
CREATE TABLE `matter_event_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`category` text DEFAULT 'litigation' NOT NULL,
	`origin` text DEFAULT 'firm' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_event_type_name_check" CHECK(length("matter_event_type"."name") > 0),
	CONSTRAINT "matter_event_type_category_check" CHECK("matter_event_type"."category" IN ('litigation', 'transaction', 'firm', 'other')),
	CONSTRAINT "matter_event_type_origin_check" CHECK("matter_event_type"."origin" IN ('platform', 'firm'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_event_type_name_unique_index` ON `matter_event_type` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_event_type_code_unique_index` ON `matter_event_type` (`code`);--> statement-breakpoint
CREATE TABLE `matter_event` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`event_type_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_on` text NOT NULL,
	`starts_at_time` text,
	`ends_on` text,
	`ends_at_time` text,
	`time_zone` text NOT NULL,
	`location_text` text,
	`court_reference` text,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_type_id`) REFERENCES `matter_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_event_title_check" CHECK(length("matter_event"."title") > 0),
	CONSTRAINT "matter_event_status_check" CHECK("matter_event"."status" IN ('scheduled', 'occurred', 'cancelled')),
	CONSTRAINT "matter_event_time_zone_check" CHECK(length("matter_event"."time_zone") > 0),
	CONSTRAINT "matter_event_starts_on_shape_check" CHECK("matter_event"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_event_ends_on_shape_check" CHECK("matter_event"."ends_on" IS NULL OR "matter_event"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_event_starts_at_time_shape_check" CHECK("matter_event"."starts_at_time" IS NULL OR "matter_event"."starts_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_event_ends_at_time_shape_check" CHECK("matter_event"."ends_at_time" IS NULL OR "matter_event"."ends_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_event_range_check" CHECK("matter_event"."ends_on" IS NULL OR "matter_event"."ends_on" >= "matter_event"."starts_on"),
	CONSTRAINT "matter_event_end_time_check" CHECK("matter_event"."ends_at_time" IS NULL OR "matter_event"."starts_at_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `matter_event_matter_starts_on_id_index` ON `matter_event` (`matter_id`,`starts_on`,`id`);--> statement-breakpoint
CREATE INDEX `matter_event_starts_on_id_index` ON `matter_event` (`starts_on`,`id`);--> statement-breakpoint
CREATE INDEX `matter_event_status_starts_on_index` ON `matter_event` (`status`,`starts_on`);--> statement-breakpoint
CREATE INDEX `matter_event_type_index` ON `matter_event` (`event_type_id`);--> statement-breakpoint
CREATE TABLE `matter_event_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`member_user_id` text,
	`entity_id` text,
	`participant_name` text,
	`role` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_event_participant_kind_check" CHECK("matter_event_participant"."participant_kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "matter_event_participant_shape_check" CHECK(("matter_event_participant"."participant_kind" = 'member' AND "matter_event_participant"."member_user_id" IS NOT NULL)
        OR ("matter_event_participant"."participant_kind" = 'entity' AND "matter_event_participant"."entity_id" IS NOT NULL)
        OR ("matter_event_participant"."participant_kind" = 'external' AND "matter_event_participant"."participant_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `matter_event_participant_event_index` ON `matter_event_participant` (`event_id`);--> statement-breakpoint
CREATE INDEX `matter_event_participant_member_index` ON `matter_event_participant` (`member_user_id`);--> statement-breakpoint
CREATE INDEX `matter_event_participant_entity_index` ON `matter_event_participant` (`entity_id`);--> statement-breakpoint
CREATE TABLE `matter_deadline` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`due_on` text NOT NULL,
	`due_at_time` text,
	`time_zone` text NOT NULL,
	`source` text DEFAULT 'member' NOT NULL,
	`catalog_entry_key` text,
	`catalog_version` text,
	`authority_text` text,
	`trigger_event_id` text,
	`state` text DEFAULT 'open' NOT NULL,
	`satisfied_at` text,
	`satisfied_by` text,
	`satisfying_event_id` text,
	`satisfaction_note` text,
	`state_reason` text,
	`superseded_by_deadline_id` text,
	`priority` integer,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`satisfying_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_deadline_title_check" CHECK(length("matter_deadline"."title") > 0),
	CONSTRAINT "matter_deadline_time_zone_check" CHECK(length("matter_deadline"."time_zone") > 0),
	CONSTRAINT "matter_deadline_due_on_shape_check" CHECK("matter_deadline"."due_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_deadline_due_at_time_shape_check" CHECK("matter_deadline"."due_at_time" IS NULL OR "matter_deadline"."due_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_deadline_source_check" CHECK("matter_deadline"."source" IN ('member', 'court_order', 'statutory_catalog')),
	CONSTRAINT "matter_deadline_catalog_shape_check" CHECK(("matter_deadline"."source" = 'statutory_catalog' AND "matter_deadline"."catalog_entry_key" IS NOT NULL AND "matter_deadline"."catalog_version" IS NOT NULL)
        OR ("matter_deadline"."source" <> 'statutory_catalog' AND "matter_deadline"."catalog_entry_key" IS NULL AND "matter_deadline"."catalog_version" IS NULL)),
	CONSTRAINT "matter_deadline_state_check" CHECK("matter_deadline"."state" IN ('open', 'satisfied', 'vacated', 'superseded')),
	CONSTRAINT "matter_deadline_state_reason_check" CHECK("matter_deadline"."state" NOT IN ('vacated', 'superseded') OR ("matter_deadline"."state_reason" IS NOT NULL AND length("matter_deadline"."state_reason") > 0)),
	CONSTRAINT "matter_deadline_satisfaction_shape_check" CHECK(("matter_deadline"."state" = 'satisfied' AND "matter_deadline"."satisfied_at" IS NOT NULL AND "matter_deadline"."satisfied_by" IS NOT NULL)
        OR ("matter_deadline"."state" <> 'satisfied' AND "matter_deadline"."satisfied_at" IS NULL AND "matter_deadline"."satisfied_by" IS NULL)),
	CONSTRAINT "matter_deadline_superseded_shape_check" CHECK(("matter_deadline"."superseded_by_deadline_id" IS NULL) OR ("matter_deadline"."state" = 'superseded')),
	CONSTRAINT "matter_deadline_priority_check" CHECK("matter_deadline"."priority" IS NULL OR "matter_deadline"."priority" > 0)
);
--> statement-breakpoint
CREATE INDEX `matter_deadline_state_due_on_id_index` ON `matter_deadline` (`state`,`due_on`,`id`);--> statement-breakpoint
CREATE INDEX `matter_deadline_matter_due_on_id_index` ON `matter_deadline` (`matter_id`,`due_on`,`id`);--> statement-breakpoint
CREATE INDEX `matter_deadline_trigger_event_index` ON `matter_deadline` (`trigger_event_id`);--> statement-breakpoint
-- The office's IANA time zone. Nullable under expand-contract: offices recorded before this column
-- existed carry no zone, and the one function that reads it resolves a null to the platform's
-- normalized zone rather than guessing an office's location.
ALTER TABLE `location` ADD `time_zone` text;--> statement-breakpoint
-- Two additive index creations on tables that already hold data, and no table is rebuilt.
--
-- The audit-log composite exists for exactly one read: a matter's own lifecycle (opened, closed,
-- reopened), which lives on two nullable `matter` columns and in this log and nowhere else. That is
-- the ONLY thing the calendar reads from this table, over a strict allowlist of event keys — the log
-- records when a row was WRITTEN rather than when the thing happened, so it is not and must not
-- become the timeline's general substrate.
CREATE INDEX `audit_log_subject_created_id_index` ON `audit_log` (`subject_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `conflicts_check_subject_matter_created_id_index` ON `conflicts_check` (`subject_matter_id`,`created_at`,`id`);--> statement-breakpoint
-- The starting event-type vocabulary, seeded as `platform` rows. A firm extends it and deactivates
-- what it does not use; a platform row's name and code are immutable to the firm, so the shared
-- vocabulary means the same thing everywhere while nothing blocks a practice with a proceeding
-- nobody thought of. This list is a starting vocabulary and NOT a claim about any jurisdiction's
-- procedure, which is exactly why it is data rather than an enum. `category` groups and draws icons;
-- no engine branches on it.
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_hearing00000000000000', 'Hearing', 'HEARING', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_trial0000000000000000', 'Trial', 'TRIAL', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_filing000000000000000', 'Filing', 'FILING', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_service00000000000000', 'Service', 'SERVICE', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_orderEntered000000000', 'Order entered', 'ORDER', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_judgmentEntered000000', 'Judgment entered', 'JUDGMENT', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_deposition00000000000', 'Deposition', 'DEPO', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_mediation000000000000', 'Mediation', 'MEDIATION', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_arbitration0000000000', 'Arbitration', 'ARBITRATION', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_settlementConference0', 'Settlement conference', 'SETTLEMENT', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_statusConference00000', 'Status conference', 'STATUS', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_discoveryCutOff000000', 'Discovery cut-off', 'DISCOVERY', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_appealFiled0000000000', 'Appeal filed', 'APPEAL', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_noticeReceived0000000', 'Notice received', 'NOTICE', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_clientMeeting00000000', 'Client meeting', 'MEETING', 'firm', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_siteVisit000000000000', 'Site visit', 'SITEVISIT', 'firm', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_call00000000000000000', 'Call', 'CALL', 'firm', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');--> statement-breakpoint
-- The two calendar permissions, seeded onto the default roles.
--
-- calendar:read is broad, and deliberately reaches Read-only too: "when is the hearing" and "what
-- has happened on this case" are questions everybody working in a firm asks, and a case timeline
-- that some seats cannot see is one people keep in a spreadsheet instead. calendar:manage asserts
-- when a hearing IS and when a deadline falls, so it reaches the seats that appear and docket —
-- Owner/Admin, Attorney, Paralegal — and not Billing or Read-only. The rolePermission_ handles are
-- minted once and committed as literals; the role_id values are the default roles from the
-- member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadOwnerAdm0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'calendar:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'calendar:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'calendar:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadBilling00', 'role_hwwC1D98d8Lazc_asL6vO', 'calendar:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadReadOnly0', 'role_WojF9F7kksBEftsmZGNhb', 'calendar:read');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarManageOwnrAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'calendar:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarManageAttorny', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'calendar:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarManageParalgl', 'role_917LCQyRKP50Z9bW89vXl', 'calendar:manage');
