-- A POLL AND A QUESTION ARE ON THE RECORD, ON CHAT'S OWN TERMS.
--
-- A host asking the room a closed question and the room answering is a thing the meeting produced,
-- and a question somebody put to the room is content in exactly the sense a chat message is. So both
-- are rows written through the firm-scoped data-access layer, with audit rows of identifiers and
-- instants — the second and third stored content of the meeting subsystem, after meeting_message.
--
-- FOUR TABLES FOR A POLL, AND THE SPLIT IS THE ANONYMITY. meeting_poll_answer holds WHAT was chosen
-- and, on a poll that does not show names, nothing about who; meeting_poll_respondent holds THAT a
-- stay answered and nothing about what, and is the one home of WHEN. The tally is a count of answer
-- rows and the ballot-stuffing guard is the respondent's unique index; neither table can answer the
-- other's question. Options are rows rather than a JSON array so an answer can only name one that
-- exists: the answer names its option as the pair (poll_id, option_id), against the option table's
-- own unique pair, so an answer to ANOTHER poll's option fails at the foreign key.
--
-- EVERY STAY IS NAMED BY VALUE, ACROSS THREE KINDS. A member's stay is a meeting_attendance row, a
-- guest's a meeting_guest_stay row, and a webinar's audience ('attendee') will hold a stay table of
-- its own — so participant_kind says which table a handle belongs to and participant_id carries it
-- with no foreign key, on meeting_message's precedent. The third kind is in every CHECK NOW, because
-- widening a CHECK later is a rebuild of a table other tables point at, which this lineage refuses.
--
-- A POLL AND A QUESTION CARRY breakout_id BY VALUE, null for the main room. The breakout table does
-- not exist yet; a nullable column added now is what lets a breakout scope them without a rebuild.
--
-- HAND-WRITTEN rather than generated: the tables are created parent first (drizzle-kit emitted the
-- answer table ahead of the option table its composite key references), and the reasoning sits with
-- the DDL. The snapshot is refreshed in the same commit — see packages/database/CLAUDE.md.
CREATE TABLE `meeting_poll` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`asked_by_user_id` text NOT NULL,
	`question` text NOT NULL,
	`anonymous` integer NOT NULL,
	`max_choices` integer DEFAULT 1 NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`closed_by_user_id` text,
	`breakout_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asked_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_poll_anonymous_check" CHECK("meeting_poll"."anonymous" IN (0, 1)),
	CONSTRAINT "meeting_poll_max_choices_check" CHECK("meeting_poll"."max_choices" BETWEEN 1 AND 10),
	CONSTRAINT "meeting_poll_question_length_check" CHECK(length("meeting_poll"."question") > 0 AND length("meeting_poll"."question") <= 500),
	CONSTRAINT "meeting_poll_closed_shape_check" CHECK(("meeting_poll"."closed_at" IS NULL AND "meeting_poll"."closed_by_user_id" IS NULL)
        OR ("meeting_poll"."closed_at" IS NOT NULL AND "meeting_poll"."closed_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `meeting_poll_meeting_opened_index` ON `meeting_poll` (`meeting_id`,`opened_at`,`id`);--> statement-breakpoint
CREATE TABLE `meeting_poll_option` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `meeting_poll`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_poll_option_position_check" CHECK("meeting_poll_option"."position" BETWEEN 0 AND 9),
	CONSTRAINT "meeting_poll_option_label_length_check" CHECK(length("meeting_poll_option"."label") > 0 AND length("meeting_poll_option"."label") <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_poll_option_poll_position_unique_index` ON `meeting_poll_option` (`poll_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_poll_option_poll_id_unique_index` ON `meeting_poll_option` (`poll_id`,`id`);--> statement-breakpoint
CREATE TABLE `meeting_poll_respondent` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`answered_at` text NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `meeting_poll`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_poll_respondent_participant_kind_check" CHECK("meeting_poll_respondent"."participant_kind" IN ('member', 'guest', 'attendee'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_poll_respondent_participation_unique_index` ON `meeting_poll_respondent` (`poll_id`,`participant_kind`,`participant_id`);--> statement-breakpoint
CREATE TABLE `meeting_poll_answer` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_id` text NOT NULL,
	`option_id` text NOT NULL,
	`participant_kind` text,
	`participant_id` text,
	FOREIGN KEY (`poll_id`) REFERENCES `meeting_poll`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`poll_id`,`option_id`) REFERENCES `meeting_poll_option`(`poll_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_poll_answer_participant_shape_check" CHECK(("meeting_poll_answer"."participant_kind" IS NULL AND "meeting_poll_answer"."participant_id" IS NULL)
        OR ("meeting_poll_answer"."participant_kind" IS NOT NULL AND "meeting_poll_answer"."participant_id" IS NOT NULL)),
	CONSTRAINT "meeting_poll_answer_participant_kind_check" CHECK("meeting_poll_answer"."participant_kind" IS NULL OR "meeting_poll_answer"."participant_kind" IN ('member', 'guest', 'attendee'))
);
--> statement-breakpoint
CREATE INDEX `meeting_poll_answer_poll_option_index` ON `meeting_poll_answer` (`poll_id`,`option_id`);--> statement-breakpoint
CREATE TABLE `meeting_question` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`body` text NOT NULL,
	`asked_at` text NOT NULL,
	`answered_at` text,
	`answered_by_user_id` text,
	`redacted_at` text,
	`redacted_by_user_id` text,
	`breakout_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answered_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redacted_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_question_answered_shape_check" CHECK(("meeting_question"."answered_at" IS NULL AND "meeting_question"."answered_by_user_id" IS NULL)
        OR ("meeting_question"."answered_at" IS NOT NULL AND "meeting_question"."answered_by_user_id" IS NOT NULL)),
	CONSTRAINT "meeting_question_redaction_shape_check" CHECK(("meeting_question"."redacted_at" IS NULL AND "meeting_question"."redacted_by_user_id" IS NULL)
        OR ("meeting_question"."redacted_at" IS NOT NULL AND "meeting_question"."redacted_by_user_id" IS NOT NULL)),
	CONSTRAINT "meeting_question_redacted_body_check" CHECK(("meeting_question"."redacted_at" IS NULL AND length("meeting_question"."body") > 0)
        OR ("meeting_question"."redacted_at" IS NOT NULL AND length("meeting_question"."body") = 0)),
	CONSTRAINT "meeting_question_body_length_check" CHECK(length("meeting_question"."body") <= 1000),
	CONSTRAINT "meeting_question_participant_kind_check" CHECK("meeting_question"."participant_kind" IN ('member', 'guest', 'attendee'))
);
--> statement-breakpoint
CREATE INDEX `meeting_question_meeting_asked_index` ON `meeting_question` (`meeting_id`,`asked_at`,`id`);--> statement-breakpoint
CREATE TABLE `meeting_question_upvote` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`participant_id` text NOT NULL,
	`upvoted_at` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `meeting_question`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_question_upvote_participant_kind_check" CHECK("meeting_question_upvote"."participant_kind" IN ('member', 'guest', 'attendee'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_question_upvote_participation_unique_index` ON `meeting_question_upvote` (`question_id`,`participant_kind`,`participant_id`);
