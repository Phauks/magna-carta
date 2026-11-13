CREATE TABLE `magnus_conversation_permission` (
	`conversation_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `permission`),
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "magnus_conversation_permission_check" CHECK("magnus_conversation_permission"."permission" IN ('own-matter-conversations'))
);
