CREATE TABLE `meeting` (
	`id` text PRIMARY KEY NOT NULL,
	`event_kind` text NOT NULL,
	`matter_event_id` text,
	`firm_event_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`ended_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ended_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_event_kind_check" CHECK("meeting"."event_kind" IN ('matter', 'firm')),
	CONSTRAINT "meeting_status_check" CHECK("meeting"."status" IN ('scheduled', 'live', 'ended')),
	CONSTRAINT "meeting_event_shape_check" CHECK(("meeting"."event_kind" = 'matter' AND "meeting"."matter_event_id" IS NOT NULL AND "meeting"."firm_event_id" IS NULL)
        OR ("meeting"."event_kind" = 'firm' AND "meeting"."firm_event_id" IS NOT NULL AND "meeting"."matter_event_id" IS NULL)),
	CONSTRAINT "meeting_ended_shape_check" CHECK(("meeting"."ended_at" IS NULL AND "meeting"."ended_by_user_id" IS NULL)
        OR ("meeting"."ended_at" IS NOT NULL AND "meeting"."ended_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_matter_event_unique_index` ON `meeting` (`matter_event_id`) WHERE "meeting"."matter_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_firm_event_unique_index` ON `meeting` (`firm_event_id`) WHERE "meeting"."firm_event_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `meeting_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_attendance_span_check" CHECK("meeting_attendance"."left_at" IS NULL OR "meeting_attendance"."left_at" >= "meeting_attendance"."joined_at")
);
--> statement-breakpoint
CREATE INDEX `meeting_attendance_meeting_user_index` ON `meeting_attendance` (`meeting_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `meeting_attendance_meeting_left_at_index` ON `meeting_attendance` (`meeting_id`,`left_at`);