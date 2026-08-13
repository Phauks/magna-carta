CREATE TABLE `community_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_profile_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_firm_id` text NOT NULL,
	`body` text NOT NULL,
	`is_operator_response` integer DEFAULT false NOT NULL,
	`visibility` text DEFAULT 'pending_first_write_review' NOT NULL,
	`hidden_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_profile_id`) REFERENCES `community_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `community_comment_post_index` ON `community_comment` (`post_id`,`visibility`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_comment_author_profile_index` ON `community_comment` (`author_profile_id`);--> statement-breakpoint
CREATE TABLE `community_flag` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`reporter_user_id` text NOT NULL,
	`reporter_firm_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_flag_subject_reporter_unique` ON `community_flag` (`subject_id`,`reporter_user_id`);--> statement-breakpoint
CREATE INDEX `community_flag_subject_index` ON `community_flag` (`subject_id`,`status`);--> statement-breakpoint
CREATE INDEX `community_flag_status_created_at_index` ON `community_flag` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_moderation_action` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_user_id` text,
	`reason` text,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `community_moderation_action_subject_index` ON `community_moderation_action` (`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_moderation_action_created_at_index` ON `community_moderation_action` (`created_at`);--> statement-breakpoint
CREATE TABLE `community_post` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_profile_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_firm_id` text NOT NULL,
	`status` text,
	`decline_reason` text,
	`decline_note` text,
	`duplicate_of_post_id` text,
	`accepted_comment_id` text,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`distinct_firm_vote_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'pending_first_write_review' NOT NULL,
	`hidden_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`author_profile_id`) REFERENCES `community_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_post_number_unique` ON `community_post` (`number`);--> statement-breakpoint
CREATE INDEX `community_post_category_index` ON `community_post` (`category`,`visibility`,`status`);--> statement-breakpoint
CREATE INDEX `community_post_kind_created_at_index` ON `community_post` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_post_last_activity_index` ON `community_post` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `community_post_author_profile_index` ON `community_post` (`author_profile_id`);--> statement-breakpoint
CREATE INDEX `community_post_status_index` ON `community_post` (`status`);--> statement-breakpoint
CREATE TABLE `community_post_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`post_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_post_number_allocation_pk` ON `community_post_number_allocation` (`scope_key`,`drawn_value`);--> statement-breakpoint
CREATE TABLE `community_post_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`firm_id` text NOT NULL,
	`display_name` text NOT NULL,
	`is_pseudonym` integer DEFAULT false NOT NULL,
	`badge` text DEFAULT 'none' NOT NULL,
	`first_write_approved_at` text,
	`write_barred_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_profile_user_id_unique` ON `community_profile` (`user_id`);--> statement-breakpoint
CREATE INDEX `community_profile_firm_id_index` ON `community_profile` (`firm_id`);--> statement-breakpoint
CREATE TABLE `community_vote` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`user_id` text NOT NULL,
	`firm_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `community_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `community_profile`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_vote_post_user_unique` ON `community_vote` (`post_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `community_vote_post_firm_index` ON `community_vote` (`post_id`,`firm_id`);--> statement-breakpoint
CREATE INDEX `community_vote_profile_index` ON `community_vote` (`profile_id`);