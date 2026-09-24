CREATE TABLE `file_version_participant` (
	`version_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	PRIMARY KEY(`version_id`, `member_user_id`),
	FOREIGN KEY (`version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `file_version` ADD `save_kind` text;