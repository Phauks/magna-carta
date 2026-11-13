CREATE TABLE `magnus_conversation_shelf` (
	`conversation_id` text NOT NULL,
	`member_id` text NOT NULL,
	`folder_id` text,
	`pinned_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `member_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `magnus_folder`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `magnus_conversation_shelf_folder_index` ON `magnus_conversation_shelf` (`member_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `magnus_conversation_shelf_pinned_index` ON `magnus_conversation_shelf` (`member_id`,`pinned_at`);--> statement-breakpoint
CREATE TABLE `magnus_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `magnus_folder_member_index` ON `magnus_folder` (`member_id`,`name`);