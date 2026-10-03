-- A READY TRANSCRIPT HAS A SUMMARY, AND THE THINGS SOMEBODY UNDERTOOK TO DO IN THE MEETING.
--
-- Two tables, parent first:
--
--   meeting_summary              one per transcript. A state, the model the run was sent to and the
--                                snapshot that answered, the provider's own token counts and how many
--                                calls the run made, a refusal's closed reason or a failure's Error ID,
--                                the lease one consumer holds while it writes it, and the summary's text.
--                                The text is DERIVED CONTENT AND WORK PRODUCT — the platform's
--                                characterization of a privileged conversation — never logged, never in
--                                an audit row, never in an error payload.
--   meeting_summary_action_item  one thing the summary says somebody undertook to do, in order. Its owner
--                                is a member only on an exact match to a participant's name, its due date
--                                only a date the transcript stated, and its task the one a member made of
--                                it through the task subsystem's own create path. The text is derived
--                                content, as the summary's is.
--
-- Both tables are new, so their vocabularies are whole now: a summary is pending, ready (with its text),
-- failed (with an Error ID) or refused (with one of three reasons — disabled, not-eligible,
-- transcript-empty — and only a refusal carries one). A due date carries the shared civil-date guard.
CREATE TABLE `meeting_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`transcript_id` text NOT NULL,
	`state` text NOT NULL,
	`model_id` text,
	`snapshot_id` text,
	`summary_text` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`model_calls` integer DEFAULT 0 NOT NULL,
	`refusal_reason` text,
	`failure_error_id` text,
	`model_failures` integer DEFAULT 0 NOT NULL,
	`claimed_at` text,
	`progress_at` text,
	`requested_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recording_id`) REFERENCES `meeting_recording`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transcript_id`) REFERENCES `meeting_transcript`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_summary_state_check" CHECK("meeting_summary"."state" IN ('pending', 'ready', 'failed', 'refused')),
	CONSTRAINT "meeting_summary_refusal_reason_check" CHECK("meeting_summary"."refusal_reason" IS NULL OR "meeting_summary"."refusal_reason" IN ('not-eligible', 'disabled', 'transcript-empty')),
	CONSTRAINT "meeting_summary_settled_shape_check" CHECK(("meeting_summary"."state" <> 'ready' OR "meeting_summary"."summary_text" IS NOT NULL)
        AND ("meeting_summary"."state" <> 'failed' OR "meeting_summary"."failure_error_id" IS NOT NULL)
        AND (("meeting_summary"."state" = 'refused') = ("meeting_summary"."refusal_reason" IS NOT NULL))),
	CONSTRAINT "meeting_summary_counts_check" CHECK("meeting_summary"."input_tokens" >= 0 AND "meeting_summary"."output_tokens" >= 0 AND "meeting_summary"."model_calls" >= 0
        AND "meeting_summary"."model_failures" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_summary_transcript_unique_index` ON `meeting_summary` (`transcript_id`);--> statement-breakpoint
CREATE INDEX `meeting_summary_meeting_index` ON `meeting_summary` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `meeting_summary_recording_index` ON `meeting_summary` (`recording_id`);--> statement-breakpoint
CREATE INDEX `meeting_summary_state_index` ON `meeting_summary` (`state`);--> statement-breakpoint
CREATE TABLE `meeting_summary_action_item` (
	`id` text PRIMARY KEY NOT NULL,
	`summary_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`owner_user_id` text,
	`due_on` text,
	`task_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`summary_id`) REFERENCES `meeting_summary`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "meeting_summary_action_item_shape_check" CHECK("meeting_summary_action_item"."ordinal" >= 0 AND length("meeting_summary_action_item"."text") > 0),
	CONSTRAINT "meeting_summary_action_item_due_on_shape_check" CHECK("meeting_summary_action_item"."due_on" IS NULL OR "meeting_summary_action_item"."due_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_summary_action_item_ordinal_unique_index` ON `meeting_summary_action_item` (`summary_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `meeting_summary_action_item_task_index` ON `meeting_summary_action_item` (`task_id`);