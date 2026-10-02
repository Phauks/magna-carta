CREATE TABLE `file_version_change` (
	`version_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`author_name` text NOT NULL,
	`author_user_id` text,
	`changed_at` text,
	`text` text NOT NULL,
	`text_truncated` integer DEFAULT 0 NOT NULL,
	`part` text NOT NULL,
	`paragraph_index` integer NOT NULL,
	PRIMARY KEY(`version_id`, `sequence`),
	FOREIGN KEY (`version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_version_change_kind_check" CHECK("file_version_change"."kind" IN ('insertion', 'deletion', 'formatting'))
);
