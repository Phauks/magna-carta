-- A MEMBER'S PERSONAL ROOM.
--
-- A standing room a member always has, reached by a link that does not change. The room row holds
-- the link and the owner's defaults and nothing more: each time its owner opens it, an ordinary event
-- and an ordinary meeting are written, and meeting.personal_room_id names the room the session
-- belongs to. One open session per room is a partial unique index on meeting, because opening is
-- find-or-open and two tabs pressing Open together must end in one session.
--
CREATE TABLE `meeting_personal_room` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`link_code` text NOT NULL,
	`medium` text DEFAULT 'video' NOT NULL,
	`lobby` text DEFAULT 'on' NOT NULL,
	`link_replaced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_personal_room_medium_check" CHECK("meeting_personal_room"."medium" IN ('video', 'audio')),
	CONSTRAINT "meeting_personal_room_lobby_check" CHECK("meeting_personal_room"."lobby" IN ('off', 'on')),
	CONSTRAINT "meeting_personal_room_link_code_shape_check" CHECK(length("meeting_personal_room"."link_code") = 10 AND "meeting_personal_room"."link_code" NOT GLOB '*[^a-z0-9]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_personal_room_owner_unique_index` ON `meeting_personal_room` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_personal_room_link_code_unique_index` ON `meeting_personal_room` (`link_code`);--> statement-breakpoint
ALTER TABLE `meeting` ADD `personal_room_id` text REFERENCES meeting_personal_room(id);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_personal_room_open_session_unique_index` ON `meeting` (`personal_room_id`) WHERE "meeting"."personal_room_id" IS NOT NULL AND "meeting"."status" <> 'ended';--> statement-breakpoint
ALTER TABLE `meeting` ADD `encrypted` integer DEFAULT false NOT NULL;
