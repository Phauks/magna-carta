ALTER TABLE `directory_email` ADD COLUMN `normalized_address` text;--> statement-breakpoint
CREATE INDEX `directory_email_normalized_address_index` ON `directory_email` (`normalized_address`);
