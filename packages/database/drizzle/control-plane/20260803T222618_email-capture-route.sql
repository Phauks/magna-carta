CREATE TABLE `email_capture_route` (
	`token` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `email_capture_route_firm_id_index` ON `email_capture_route` (`firm_id`);