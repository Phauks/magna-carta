CREATE TABLE `community_board_switch` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`changed_at` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `community_session_handoff` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`redeemed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `community_session_handoff_redeemed_index` ON `community_session_handoff` (`redeemed_at`);