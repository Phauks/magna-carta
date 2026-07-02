DROP INDEX `file_matter_id_index`;--> statement-breakpoint
DROP INDEX `file_folder_id_index`;--> statement-breakpoint
CREATE INDEX `file_matter_id_created_at_id_index` ON `file` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `file_folder_id_created_at_id_index` ON `file` (`folder_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `folder_matter_id_index`;--> statement-breakpoint
CREATE INDEX `folder_matter_id_created_at_id_index` ON `folder` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `matter_responsible_member_id_index`;--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_created_at_id_index` ON `matter` (`responsible_member_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_created_at_id_index` ON `matter` (`created_at`,`id`);