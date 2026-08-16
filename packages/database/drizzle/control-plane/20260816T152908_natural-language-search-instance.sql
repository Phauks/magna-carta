CREATE TABLE `ai_search_instance` (
	`firm_id` text PRIMARY KEY NOT NULL,
	`instance_name` text NOT NULL,
	`instance_identifier` text,
	`configuration_generation` integer NOT NULL,
	`state` text NOT NULL,
	`teardown_response` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_search_instance_state_check" CHECK("ai_search_instance"."state" IN ('provisioning', 'ready', 'tearing-down', 'absent'))
);
--> statement-breakpoint
CREATE INDEX `ai_search_instance_state_index` ON `ai_search_instance` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_search_instance_instance_name_unique_index` ON `ai_search_instance` (`instance_name`);