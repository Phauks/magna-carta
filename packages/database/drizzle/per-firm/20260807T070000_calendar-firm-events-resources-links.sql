-- The calendar's second scope and the machinery around it: events that belong to the firm rather
-- than to a matter, the rooms and other resources those events occupy, typed links between events,
-- and the additive column that lets a cancelled setting say why it is no longer happening.
--
-- Everything here is additive — five new tables, one ALTER TABLE ADD, seed rows — and no shipped
-- table is rebuilt. That is not just discipline but a design input: firm_event exists as its own
-- table precisely because loosening matter_event.matter_id to nullable would be a rebuild, and
-- matter_event reuses 'cancelled' for a continued setting because widening its status CHECK would
-- be one too.
--
-- Hand-ordered parent-first (firm_event before its participants and bookings), which is why this
-- migration is hand-written rather than generated; the two partial unique indexes that hold a
-- continuance chain to a chain — at most one predecessor and at most one successor per setting,
-- refused by the database rather than by a service invariant somebody forgets under concurrency —
-- are declared in the drizzle schema too, so a later regeneration keeps them.
CREATE TABLE `firm_event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`status_reason` text,
	`starts_on` text NOT NULL,
	`starts_at_time` text,
	`ends_on` text,
	`ends_at_time` text,
	`time_zone` text NOT NULL,
	`audience` text DEFAULT 'participants' NOT NULL,
	`location_id` text,
	`location_text` text,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `matter_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_event_title_check" CHECK(length("firm_event"."title") > 0),
	CONSTRAINT "firm_event_status_check" CHECK("firm_event"."status" IN ('scheduled', 'occurred', 'cancelled')),
	CONSTRAINT "firm_event_audience_check" CHECK("firm_event"."audience" IN ('all_members', 'participants')),
	CONSTRAINT "firm_event_time_zone_check" CHECK(length("firm_event"."time_zone") > 0),
	CONSTRAINT "firm_event_starts_on_shape_check" CHECK("firm_event"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_event_ends_on_shape_check" CHECK("firm_event"."ends_on" IS NULL OR "firm_event"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_event_starts_at_time_shape_check" CHECK("firm_event"."starts_at_time" IS NULL OR "firm_event"."starts_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_event_ends_at_time_shape_check" CHECK("firm_event"."ends_at_time" IS NULL OR "firm_event"."ends_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_event_range_check" CHECK("firm_event"."ends_on" IS NULL OR "firm_event"."ends_on" >= "firm_event"."starts_on"),
	CONSTRAINT "firm_event_end_time_check" CHECK("firm_event"."ends_at_time" IS NULL OR "firm_event"."starts_at_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `firm_event_starts_on_id_index` ON `firm_event` (`starts_on`,`id`);--> statement-breakpoint
CREATE INDEX `firm_event_status_starts_on_index` ON `firm_event` (`status`,`starts_on`);--> statement-breakpoint
CREATE INDEX `firm_event_location_index` ON `firm_event` (`location_id`);--> statement-breakpoint
CREATE TABLE `firm_event_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_event_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`member_user_id` text,
	`entity_id` text,
	`participant_name` text,
	`role` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_event_participant_kind_check" CHECK("firm_event_participant"."participant_kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "firm_event_participant_shape_check" CHECK(("firm_event_participant"."participant_kind" = 'member' AND "firm_event_participant"."member_user_id" IS NOT NULL)
        OR ("firm_event_participant"."participant_kind" = 'entity' AND "firm_event_participant"."entity_id" IS NOT NULL)
        OR ("firm_event_participant"."participant_kind" = 'external' AND "firm_event_participant"."participant_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `firm_event_participant_event_index` ON `firm_event_participant` (`firm_event_id`);--> statement-breakpoint
CREATE INDEX `firm_event_participant_member_index` ON `firm_event_participant` (`member_user_id`);--> statement-breakpoint
CREATE TABLE `firm_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`location_id` text,
	`capacity` integer,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_resource_name_check" CHECK(length("firm_resource"."name") > 0),
	CONSTRAINT "firm_resource_kind_check" CHECK("firm_resource"."kind" IN ('room', 'vehicle', 'equipment', 'other')),
	CONSTRAINT "firm_resource_capacity_check" CHECK("firm_resource"."capacity" IS NULL OR "firm_resource"."capacity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_resource_name_unique_index` ON `firm_resource` (`name`);--> statement-breakpoint
CREATE TABLE `firm_resource_booking` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`matter_event_id` text,
	`firm_event_id` text,
	`starts_on` text NOT NULL,
	`starts_at_time` text,
	`ends_on` text,
	`ends_at_time` text,
	`time_zone` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `firm_resource`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_resource_booking_event_shape_check" CHECK(("firm_resource_booking"."matter_event_id" IS NOT NULL AND "firm_resource_booking"."firm_event_id" IS NULL)
        OR ("firm_resource_booking"."matter_event_id" IS NULL AND "firm_resource_booking"."firm_event_id" IS NOT NULL)),
	CONSTRAINT "firm_resource_booking_time_zone_check" CHECK(length("firm_resource_booking"."time_zone") > 0),
	CONSTRAINT "firm_resource_booking_starts_on_shape_check" CHECK("firm_resource_booking"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_resource_booking_ends_on_shape_check" CHECK("firm_resource_booking"."ends_on" IS NULL OR "firm_resource_booking"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_resource_booking_starts_at_time_shape_check" CHECK("firm_resource_booking"."starts_at_time" IS NULL OR "firm_resource_booking"."starts_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_resource_booking_ends_at_time_shape_check" CHECK("firm_resource_booking"."ends_at_time" IS NULL OR "firm_resource_booking"."ends_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_resource_booking_range_check" CHECK("firm_resource_booking"."ends_on" IS NULL OR "firm_resource_booking"."ends_on" >= "firm_resource_booking"."starts_on"),
	CONSTRAINT "firm_resource_booking_end_time_check" CHECK("firm_resource_booking"."ends_at_time" IS NULL OR "firm_resource_booking"."starts_at_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `firm_resource_booking_resource_starts_index` ON `firm_resource_booking` (`resource_id`,`starts_on`,`id`);--> statement-breakpoint
CREATE INDEX `firm_resource_booking_matter_event_index` ON `firm_resource_booking` (`matter_event_id`);--> statement-breakpoint
CREATE INDEX `firm_resource_booking_firm_event_index` ON `firm_resource_booking` (`firm_event_id`);--> statement-breakpoint
CREATE TABLE `calendar_event_link` (
	`id` text PRIMARY KEY NOT NULL,
	`from_matter_event_id` text,
	`from_firm_event_id` text,
	`to_matter_event_id` text,
	`to_firm_event_id` text,
	`kind` text NOT NULL,
	`note` text,
	`recorded_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendar_event_link_kind_check" CHECK("calendar_event_link"."kind" IN ('continuance_of', 'related')),
	CONSTRAINT "calendar_event_link_from_shape_check" CHECK(("calendar_event_link"."from_matter_event_id" IS NOT NULL AND "calendar_event_link"."from_firm_event_id" IS NULL)
        OR ("calendar_event_link"."from_matter_event_id" IS NULL AND "calendar_event_link"."from_firm_event_id" IS NOT NULL)),
	CONSTRAINT "calendar_event_link_to_shape_check" CHECK(("calendar_event_link"."to_matter_event_id" IS NOT NULL AND "calendar_event_link"."to_firm_event_id" IS NULL)
        OR ("calendar_event_link"."to_matter_event_id" IS NULL AND "calendar_event_link"."to_firm_event_id" IS NOT NULL)),
	CONSTRAINT "calendar_event_link_continuance_matter_check" CHECK("calendar_event_link"."kind" <> 'continuance_of' OR ("calendar_event_link"."from_matter_event_id" IS NOT NULL AND "calendar_event_link"."to_matter_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `calendar_event_link_from_matter_index` ON `calendar_event_link` (`from_matter_event_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_link_from_firm_index` ON `calendar_event_link` (`from_firm_event_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_link_to_matter_index` ON `calendar_event_link` (`to_matter_event_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_link_to_firm_index` ON `calendar_event_link` (`to_firm_event_id`);--> statement-breakpoint
-- The chain constraints, enforced by the schema and not by the service: every setting has at most
-- one predecessor and at most one successor, so a hearing continued three times is a four-node path
-- walkable in both directions, and a fork is refused even under racing writes.
CREATE UNIQUE INDEX `calendar_event_link_continuance_from_unique` ON `calendar_event_link` (`from_matter_event_id`) WHERE `kind` = 'continuance_of';--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_link_continuance_to_unique` ON `calendar_event_link` (`to_matter_event_id`) WHERE `kind` = 'continuance_of';--> statement-breakpoint
-- Why a matter event is no longer happening, when it is not — set by the cancel and continuance
-- paths, optional. Additive on a shipped table; NO rebuild.
ALTER TABLE `matter_event` ADD `status_reason` text;--> statement-breakpoint
-- The firm-scope starting vocabulary, on the shared catalog (its category column already carries
-- 'firm'; a second catalog would mean curating "Meeting" twice). Platform rows: immutable names and
-- codes, deactivatable per firm. Reservation is the type that makes "book the pool car Friday" an
-- ordinary firm event with a booking attached, so a bare booking never needs to exist.
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_firmMeeting0000000000', 'Firm meeting', 'FIRMMEETING', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_training0000000000000', 'Training', 'TRAINING', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_officeClosure00000000', 'Office closure', 'CLOSURE', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_firmHoliday0000000000', 'Firm holiday', 'HOLIDAY', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_reservation0000000000', 'Reservation', 'RESERVATION', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');
