CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`code_hash` text NOT NULL,
	`verifier_hash` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`expires_at` text NOT NULL,
	`redeemed_at` text,
	`redeemed_user_id` text,
	`invited_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_code_hash_unique` ON `invitation` (`code_hash`);--> statement-breakpoint
CREATE INDEX `invitation_firm_id_index` ON `invitation` (`firm_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_index` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `registration` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`firm_display_name` text,
	`confirmation_hash` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`confirmed_at` text,
	`firm_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_confirmation_hash_unique` ON `registration` (`confirmation_hash`);--> statement-breakpoint
CREATE INDEX `registration_email_index` ON `registration` (`email`);--> statement-breakpoint
CREATE INDEX `registration_created_at_index` ON `registration` (`created_at`);--> statement-breakpoint
ALTER TABLE `firm` ADD `display_name` text;