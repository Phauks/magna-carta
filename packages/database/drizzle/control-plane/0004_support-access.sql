CREATE TABLE `platform_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_staff_email_unique` ON `platform_staff` (`email`);--> statement-breakpoint
CREATE TABLE `support_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`tier` text NOT NULL,
	`scope` text DEFAULT 'self' NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`principal_id` text,
	`requires_cosign` integer DEFAULT false NOT NULL,
	`cosigned_by_user_id` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `support_grant_firm_id_index` ON `support_grant` (`firm_id`);--> statement-breakpoint
ALTER TABLE `firm` ADD `support_requires_cosign` integer DEFAULT false NOT NULL;