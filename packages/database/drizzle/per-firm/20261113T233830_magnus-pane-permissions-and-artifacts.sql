CREATE TABLE `magnus_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `magnus_artifact_conversation_index` ON `magnus_artifact` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `magnus_artifact_version` (
	`artifact_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`content` text NOT NULL,
	`note` text,
	`written_by_turn_id` text,
	`member_user_id` text NOT NULL,
	`restored_from_version` integer,
	`created_at` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `version_number`),
	FOREIGN KEY (`artifact_id`) REFERENCES `magnus_artifact`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `magnus_conversation_permission` (
	`conversation_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `permission`),
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "magnus_conversation_permission_check" CHECK("magnus_conversation_permission"."permission" IN ('own-matter-conversations'))
);
