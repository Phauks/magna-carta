-- WHAT IS SAID IN THE CHAT STAYS ON THE FILE.
--
-- The owner's ruling of 2026-09-20: in-meeting chat is kept on the record. That makes this table the
-- meeting subsystem's first stored CONTENT — every other row it holds is identifiers and instants,
-- and the audio, the video and the screen share are routed between browsers and reach no storage
-- here at all. So a message carries what a filed message carries: a retention basis, a personal-data
-- classification, and a way to take something back that leaves the taking-back on the record too.
--
-- IT HANGS FROM THE STAY, AND THE STAY IS NAMED BY VALUE. Being in the room is what made a message
-- sayable, so the row names the stay it was said from rather than the member who said it. A member's
-- stay is a meeting_attendance row and a guest's is a meeting_guest_stay row, because
-- meeting_attendance.user_id is NOT NULL and SQLite cannot relax that in place — so a foreign key
-- onto meeting_attendance here would bar every external guest from chat, and adding the second kind
-- afterwards would be exactly the table rebuild this lineage refuses on a table anything references.
-- participant_kind says which table the handle belongs to; participant_id carries the handle with no
-- foreign key, on the matter_party / custody_owner precedent for a cross-domain reference.
-- meeting_id stays a real foreign key: that is what ties the message to the record it is part of.
--
-- HAND-WRITTEN rather than generated. The two CHECKs about the body and the redaction pair are a
-- two-sided rule, and the index carries three columns in the order the read walks them; this file is
-- authored deliberately beside the schema so the reasoning sits with the DDL. The snapshot is
-- refreshed in the same commit — see packages/database/CLAUDE.md.
CREATE TABLE `meeting_message` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`body` text NOT NULL,
	`redacted_at` text,
	`redacted_by_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redacted_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_message_redaction_shape_check" CHECK(("meeting_message"."redacted_at" IS NULL AND "meeting_message"."redacted_by_user_id" IS NULL)
        OR ("meeting_message"."redacted_at" IS NOT NULL AND "meeting_message"."redacted_by_user_id" IS NOT NULL)),
	CONSTRAINT "meeting_message_redacted_body_check" CHECK(("meeting_message"."redacted_at" IS NULL AND length("meeting_message"."body") > 0)
        OR ("meeting_message"."redacted_at" IS NOT NULL AND length("meeting_message"."body") = 0)),
	CONSTRAINT "meeting_message_body_length_check" CHECK(length("meeting_message"."body") <= 4000),
	CONSTRAINT "meeting_message_participant_kind_check" CHECK("meeting_message"."participant_kind" IN ('member', 'guest'))
);
--> statement-breakpoint
CREATE INDEX `meeting_message_meeting_sent_index` ON `meeting_message` (`meeting_id`,`sent_at`,`id`);
