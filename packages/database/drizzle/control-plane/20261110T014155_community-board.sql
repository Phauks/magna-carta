CREATE TABLE `community_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_firm_id` text NOT NULL,
	`is_team_response` integer DEFAULT false NOT NULL,
	`moderation_state` text NOT NULL,
	`held_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `community_comment_post_index` ON `community_comment` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_flag` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`comment_id` text,
	`reason` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`reporter_firm_id` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `community_comment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_flag_reporter_unique_index` ON `community_flag` (`post_id`,`comment_id`,`reporter_user_id`,`reason`);--> statement-breakpoint
CREATE TABLE `community_post` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_firm_id` text NOT NULL,
	`moderation_state` text NOT NULL,
	`held_reason` text,
	`duplicate_of_post_id` text,
	`decline_reason` text,
	`decline_note` text,
	`accepted_comment_id` text,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`firm_vote_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`triaged_at` text,
	`status_changed_at` text,
	`linked_changelog_anchor` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_post_number_unique_index` ON `community_post` (`number`);--> statement-breakpoint
CREATE INDEX `community_post_board_index` ON `community_post` (`moderation_state`,`kind`,`category`,`status`);--> statement-breakpoint
CREATE INDEX `community_post_author_index` ON `community_post` (`author_user_id`);--> statement-breakpoint
CREATE TABLE `community_profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`approved_at` text,
	`notice_dismissed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `community_vote` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`firm_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_vote_post_user_unique_index` ON `community_vote` (`post_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `community_vote_user_index` ON `community_vote` (`user_id`);