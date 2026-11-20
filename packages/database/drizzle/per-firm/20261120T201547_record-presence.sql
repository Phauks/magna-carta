CREATE TABLE `record_presence` (
	`record_kind` text NOT NULL,
	`record_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`record_kind`, `record_id`, `member_user_id`),
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "record_presence_kind_length_check" CHECK(length("record_presence"."record_kind") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX `record_presence_record_seen_index` ON `record_presence` (`record_kind`,`record_id`,`seen_at`);