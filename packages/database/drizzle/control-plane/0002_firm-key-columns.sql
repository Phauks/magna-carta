ALTER TABLE `firm` ADD `wrapped_firm_key` text;--> statement-breakpoint
ALTER TABLE `firm` ADD `firm_key_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `firm` ADD `root_key_version` integer DEFAULT 1 NOT NULL;