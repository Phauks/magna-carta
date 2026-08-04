CREATE TABLE `email_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_normalized` text,
	`first_seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_thread_subject_normalized_index` ON `email_thread` (`subject_normalized`);
--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id_value` text,
	`message_id_provenance` text NOT NULL,
	`subject` text,
	`sent_at` text,
	`received_at` text NOT NULL,
	`from_display` text,
	`from_address` text,
	`thread_id` text NOT NULL,
	`in_reply_to` text,
	`content_sha256` text NOT NULL,
	`dedup_key` text NOT NULL,
	`original_r2_key` text NOT NULL,
	`references_remote_content` integer DEFAULT 0 NOT NULL,
	`integrity` text NOT NULL,
	`dkim_verdict` text DEFAULT 'unverified' NOT NULL,
	`source_format` text NOT NULL,
	`captured_via` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_thread`(`id`),
	CONSTRAINT `email_message_provenance_check` CHECK (`message_id_provenance` IN ('header', 'mapi', 'absent')),
	CONSTRAINT `email_message_dkim_verdict_check` CHECK (`dkim_verdict` IN ('unverified', 'pass', 'fail')),
	CONSTRAINT `email_message_source_format_check` CHECK (`source_format` IN ('eml', 'msg', 'mboxMember')),
	CONSTRAINT `email_message_captured_via_check` CHECK (`captured_via` IN ('forward', 'api', 'addin', 'sync'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_dedup_key_unique_index` ON `email_message` (`dedup_key`);
--> statement-breakpoint
CREATE INDEX `email_message_thread_id_index` ON `email_message` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `email_message_message_id_value_index` ON `email_message` (`message_id_value`);
--> statement-breakpoint
CREATE INDEX `email_message_content_sha256_index` ON `email_message` (`content_sha256`);
--> statement-breakpoint
CREATE TABLE `email_matter_link` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`state` text DEFAULT 'staged' NOT NULL,
	`linked_by` text,
	`linked_at` text,
	`captured_via` text NOT NULL,
	`tags` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `email_matter_link_state_check` CHECK (`state` IN ('staged', 'filed', 'unlinked')),
	CONSTRAINT `email_matter_link_captured_via_check` CHECK (`captured_via` IN ('forward', 'api', 'addin', 'sync'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_matter_link_message_matter_unique_index` ON `email_matter_link` (`email_message_id`,`matter_id`);
--> statement-breakpoint
CREATE INDEX `email_matter_link_matter_created_id_index` ON `email_matter_link` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `email_matter_link_email_message_id_index` ON `email_matter_link` (`email_message_id`);
--> statement-breakpoint
CREATE TABLE `email_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text,
	`address` text,
	`directory_entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`),
	CONSTRAINT `email_participant_kind_check` CHECK (`kind` IN ('from', 'to', 'cc', 'bcc'))
);
--> statement-breakpoint
CREATE INDEX `email_participant_email_message_id_index` ON `email_participant` (`email_message_id`);
--> statement-breakpoint
CREATE INDEX `email_participant_directory_entity_id_index` ON `email_participant` (`directory_entity_id`);
--> statement-breakpoint
CREATE TABLE `email_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`file_id` text,
	`filename` text,
	`media_type` text,
	`disposition` text NOT NULL,
	`promoted_from_inline` integer DEFAULT 0 NOT NULL,
	`outcome` text DEFAULT 'extracted' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`),
	CONSTRAINT `email_attachment_disposition_check` CHECK (`disposition` IN ('attachment', 'inline')),
	CONSTRAINT `email_attachment_outcome_check` CHECK (`outcome` IN ('extracted', 'filtered_inline', 'oversize'))
);
--> statement-breakpoint
CREATE INDEX `email_attachment_email_message_id_index` ON `email_attachment` (`email_message_id`);
--> statement-breakpoint
CREATE INDEX `email_attachment_file_id_index` ON `email_attachment` (`file_id`);
--> statement-breakpoint
CREATE TABLE `email_capture_address` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`matter_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`rotated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `email_capture_address_kind_check` CHECK (`kind` IN ('matter', 'catchAll'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_capture_address_token_unique_index` ON `email_capture_address` (`token`);
--> statement-breakpoint
CREATE INDEX `email_capture_address_matter_id_index` ON `email_capture_address` (`matter_id`);
