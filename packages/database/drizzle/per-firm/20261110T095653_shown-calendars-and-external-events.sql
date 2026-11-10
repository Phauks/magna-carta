CREATE TABLE `calendar_sync_shown_calendar` (
	`connection_id` text NOT NULL,
	`calendar_remote_id` text NOT NULL,
	`calendar_name` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `calendar_remote_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connection`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendar_sync_shown_calendar_id_check" CHECK(length("calendar_sync_shown_calendar"."calendar_remote_id") > 0)
);
--> statement-breakpoint
CREATE TABLE `external_calendar_event` (
	`connection_id` text NOT NULL,
	`remote_event_id` text NOT NULL,
	`calendar_remote_id` text NOT NULL,
	`remote_version_tag` text,
	`title` text NOT NULL,
	`location_text` text,
	`whole_day` integer NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`starts_at` text,
	`ends_at` text,
	`read_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `remote_event_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connection`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "external_calendar_event_shape_check" CHECK(("external_calendar_event"."whole_day" = 1 AND "external_calendar_event"."starts_on" IS NOT NULL AND "external_calendar_event"."ends_on" IS NOT NULL AND "external_calendar_event"."starts_at" IS NULL AND "external_calendar_event"."ends_at" IS NULL) OR ("external_calendar_event"."whole_day" = 0 AND "external_calendar_event"."starts_on" IS NULL AND "external_calendar_event"."ends_on" IS NULL AND "external_calendar_event"."starts_at" IS NOT NULL AND "external_calendar_event"."ends_at" IS NOT NULL))
);
