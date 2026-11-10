CREATE TABLE `matter_task_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`edited_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_comment_body_nonempty_check" CHECK(length("matter_task_comment"."body") > 0)
);
--> statement-breakpoint
CREATE INDEX `matter_task_comment_task_index` ON `matter_task_comment` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `matter_task_comment_mention` (
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`comment_id`, `user_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `matter_task_comment`(`id`) ON UPDATE no action ON DELETE no action
);
