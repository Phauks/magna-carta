CREATE TABLE `platform_operator` (
	`user_id` text PRIMARY KEY NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by` text NOT NULL,
	`expires_at` text,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
