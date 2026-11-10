-- A FILED RECORDING HAS A TRANSCRIPT, MADE PER TRACK, AND IT SAYS WHERE IT COULD NOT HEAR.
--
-- Two tables, parent first:
--
--   meeting_transcript          one per filed recording. Handles, counts, instants, a state and the
--                               cursor of the windowed work that makes it — the track it is on, the
--                               staged sample it resumes at, how many segments it has written, the upload
--                               session its document is filed through, its hand-ons and its claim. No
--                               content: the words are the segments' and the filed WebVTT document's.
--   meeting_transcript_segment  one line: a span of one track's speech and what the speech model heard
--                               in it, or a gap the transcript could not hear (a lost track, one the
--                               ceiling refused, one whose audio was missing). The text is CONTENT —
--                               never logged, never in an audit row, never in an error payload.
--
-- THE SPEAKER IS THE TRACK, NAMED BY VALUE: participant_kind and participant_id (a member's attendance
-- or a guest's stay, no foreign key, on the recording track's precedent), the track itself, and the
-- member behind it. The name is read off the stay when the transcript is read or filed, never stored.
--
-- A SEGMENT'S ORDINAL IS PROVISIONAL WHILE THE TRANSCRIPT IS PENDING — negative, in the order it was
-- written — because a line's place among the other tracks' lines is known only once every track is done;
-- the settle renumbers them chronologically from zero in one statement, and a negative ordinal can never
-- collide with a final one under the unique index.
--
-- Both tables are new, so their vocabularies are whole now: a transcript is pending, ready (naming its
-- document) or failed (carrying an Error ID), and a segment is speech or a gap.
CREATE TABLE `meeting_transcript` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`state` text NOT NULL,
	`language` text,
	`model_id` text,
	`segment_count` integer,
	`word_count` integer,
	`transcribed_seconds` integer DEFAULT 0 NOT NULL,
	`file_id` text,
	`file_version_id` text,
	`failure_error_id` text,
	`cursor_track` integer DEFAULT 0 NOT NULL,
	`cursor_sample` integer DEFAULT 0 NOT NULL,
	`segments_written` integer DEFAULT 0 NOT NULL,
	`upload_session_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`progress_at` text,
	`claimed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recording_id`) REFERENCES `meeting_recording`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_transcript_state_check" CHECK("meeting_transcript"."state" IN ('pending', 'ready', 'failed')),
	CONSTRAINT "meeting_transcript_settled_shape_check" CHECK(("meeting_transcript"."state" <> 'ready' OR "meeting_transcript"."file_id" IS NOT NULL)
        AND ("meeting_transcript"."state" <> 'failed' OR "meeting_transcript"."failure_error_id" IS NOT NULL)),
	CONSTRAINT "meeting_transcript_cursor_check" CHECK("meeting_transcript"."cursor_track" >= 0 AND "meeting_transcript"."cursor_sample" >= 0 AND "meeting_transcript"."segments_written" >= 0
        AND "meeting_transcript"."transcribed_seconds" >= 0 AND "meeting_transcript"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_transcript_recording_unique_index` ON `meeting_transcript` (`recording_id`);--> statement-breakpoint
CREATE INDEX `meeting_transcript_meeting_index` ON `meeting_transcript` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `meeting_transcript_state_index` ON `meeting_transcript` (`state`);--> statement-breakpoint
CREATE TABLE `meeting_transcript_segment` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`track_id` text,
	`participant_kind` text,
	`participant_id` text,
	`user_id` text,
	`started_ms` integer NOT NULL,
	`ended_ms` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `meeting_transcript`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`track_id`) REFERENCES `meeting_recording_track`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_transcript_segment_kind_check" CHECK("meeting_transcript_segment"."kind" IN ('speech', 'gap')),
	CONSTRAINT "meeting_transcript_segment_participant_kind_check" CHECK("meeting_transcript_segment"."participant_kind" IS NULL OR "meeting_transcript_segment"."participant_kind" IN ('member', 'guest', 'attendee')),
	CONSTRAINT "meeting_transcript_segment_speaker_shape_check" CHECK(("meeting_transcript_segment"."participant_kind" IS NULL) = ("meeting_transcript_segment"."participant_id" IS NULL)
        AND ("meeting_transcript_segment"."kind" <> 'speech' OR "meeting_transcript_segment"."participant_id" IS NOT NULL)),
	CONSTRAINT "meeting_transcript_segment_span_check" CHECK("meeting_transcript_segment"."started_ms" >= 0 AND "meeting_transcript_segment"."ended_ms" >= "meeting_transcript_segment"."started_ms"),
	CONSTRAINT "meeting_transcript_segment_gap_text_check" CHECK("meeting_transcript_segment"."kind" <> 'gap' OR "meeting_transcript_segment"."text" = '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_transcript_segment_ordinal_unique_index` ON `meeting_transcript_segment` (`transcript_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `meeting_transcript_segment_started_index` ON `meeting_transcript_segment` (`transcript_id`,`started_ms`);--> statement-breakpoint
CREATE INDEX `meeting_transcript_segment_track_index` ON `meeting_transcript_segment` (`track_id`,`ordinal`);