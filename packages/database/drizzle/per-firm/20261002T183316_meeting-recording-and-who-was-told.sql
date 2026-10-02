-- A MEETING CAN BE RECORDED, AND THE RECORD SAYS WHO WAS TOLD.
--
-- The owner's ruling of 2026-09-20 made the announcement and the indicator the consent mechanism, so
-- the announcement is built as a mechanism with a record rather than as decoration on a screen. Three
-- tables, parent first:
--
--   meeting_recording         one span of a meeting's audio, from Record to stop. Identifiers,
--                             instants, counts and a state — no audio, which is staged per track in
--                             the firm's own bucket and composed into a filed document later.
--   meeting_recording_track   one participant's audio inside it. The track name is the attribution
--                             key every later transcript line rests on.
--   meeting_recording_notice  one occasion on which one stay was told: the recording started, it
--                             was running when they arrived, or it stopped. What the SERVER
--                             announced to whom, written one batch per fan-out.
--
-- EVERY STAY IS NAMED BY VALUE, ACROSS THREE KINDS, on meeting_message's precedent: participant_kind
-- says which table a handle belongs to (a member's meeting_attendance, a guest's meeting_guest_stay, a
-- webinar's attendee) and participant_id carries it with no foreign key, so a guest or a phone caller
-- can be on the record as having been told and as having a track. user_id is the member behind a
-- member's stay and null for anybody else.
--
-- THE RECORDING'S VOCABULARIES ARE WHOLE NOW. It is a parent table, and widening a CHECK on a parent is
-- the rebuild this lineage refuses — so every state and stop reason the later slices write is in the
-- CHECK before anything writes it. It carries breakout_id by value, null for the main room, on
-- meeting_poll's precedent; the one-running-recording index is partial on the main room because NULLs
-- are distinct in a unique index.
--
-- AND meetings:record GETS ITS SEATS — exactly the three roles that hold meetings:host (Owner/Admin,
-- Attorney, Paralegal), so no firm's behaviour changes on the merge: whoever could convene a meeting
-- can record one, and a firm that wants recording narrower than hosting now has a key to narrow. A
-- separate key because recording creates a durable, discoverable artifact that outlives the room, which
-- hosting does not. The house seed shape, plain and unqualified, which is the form
-- tooling/lint-ungranted-permissions reads; the role_ids are the baseline's five roles.
--
-- HAND-WRITTEN rather than generated, so the reasoning sits with the DDL and the seed rides the same
-- migration as the tables it authorizes. The snapshot is refreshed in the same commit.
CREATE TABLE `meeting_recording` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`breakout_id` text,
	`state` text NOT NULL,
	`started_by_user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`stopped_by_user_id` text,
	`stopped_at` text,
	`stop_reason` text,
	`track_count` integer DEFAULT 0 NOT NULL,
	`captured_seconds` integer,
	`file_id` text,
	`file_version_id` text,
	`failure_error_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stopped_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_recording_state_check" CHECK("meeting_recording"."state" IN ('recording', 'composing', 'filed', 'failed', 'abandoned')),
	CONSTRAINT "meeting_recording_stop_reason_check" CHECK("meeting_recording"."stop_reason" IS NULL
        OR "meeting_recording"."stop_reason" IN ('member', 'host', 'meeting-ended', 'sink-lost', 'ceiling', 'abandoned')),
	CONSTRAINT "meeting_recording_stopped_shape_check" CHECK(("meeting_recording"."state" = 'recording' AND "meeting_recording"."stopped_at" IS NULL AND "meeting_recording"."stop_reason" IS NULL)
        OR ("meeting_recording"."state" <> 'recording' AND "meeting_recording"."stopped_at" IS NOT NULL AND "meeting_recording"."stop_reason" IS NOT NULL)),
	CONSTRAINT "meeting_recording_track_count_check" CHECK("meeting_recording"."track_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `meeting_recording_meeting_started_index` ON `meeting_recording` (`meeting_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `meeting_recording_state_index` ON `meeting_recording` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_recording_one_running_unique_index` ON `meeting_recording` (`meeting_id`) WHERE "meeting_recording"."state" = 'recording' AND "meeting_recording"."breakout_id" IS NULL;--> statement-breakpoint
CREATE TABLE `meeting_recording_track` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`user_id` text,
	`track_name` text NOT NULL,
	`adapter_id` text,
	`staging_key` text,
	`first_frame_at` text,
	`last_frame_at` text,
	`frames_received` integer DEFAULT 0 NOT NULL,
	`frames_dropped` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `meeting_recording`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_recording_track_state_check" CHECK("meeting_recording_track"."state" IN ('open', 'closed', 'lost')),
	CONSTRAINT "meeting_recording_track_participant_kind_check" CHECK("meeting_recording_track"."participant_kind" IN ('member', 'guest', 'attendee')),
	CONSTRAINT "meeting_recording_track_frames_check" CHECK("meeting_recording_track"."frames_received" >= 0 AND "meeting_recording_track"."frames_dropped" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_recording_track_name_unique_index` ON `meeting_recording_track` (`recording_id`,`track_name`);--> statement-breakpoint
CREATE INDEX `meeting_recording_track_state_index` ON `meeting_recording_track` (`recording_id`,`state`);--> statement-breakpoint
CREATE TABLE `meeting_recording_notice` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`user_id` text,
	`reason` text NOT NULL,
	`delivered_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `meeting_recording`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_recording_notice_reason_check" CHECK("meeting_recording_notice"."reason" IN ('start', 'arrival', 'stop')),
	CONSTRAINT "meeting_recording_notice_participant_kind_check" CHECK("meeting_recording_notice"."participant_kind" IN ('member', 'guest', 'attendee'))
);
--> statement-breakpoint
CREATE INDEX `meeting_recording_notice_delivered_index` ON `meeting_recording_notice` (`recording_id`,`delivered_at`,`id`);--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsRecordOwner00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'meetings:record');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsRecordAttrney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'meetings:record');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_meetingsRecordParaleg', 'role_917LCQyRKP50Z9bW89vXl', 'meetings:record');
