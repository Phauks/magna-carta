CREATE TABLE `in_out_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`description` text NOT NULL,
	`from_kind` text NOT NULL,
	`from_user_id` text,
	`from_entity_id` text,
	`from_name` text NOT NULL,
	`matter_id` text,
	`kept_at` text,
	`notes` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`dropped_off_at` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`picked_up_at` text,
	`picked_up_by_kind` text,
	`picked_up_by_user_id` text,
	`picked_up_by_entity_id` text,
	`picked_up_by_name` text,
	`identity_checked` integer,
	`handed_over_by_user_id` text,
	`custody_packet_id` text,
	`moved_to_custodian_at` text,
	`moved_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`custody_packet_id`) REFERENCES `custody_packet`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "in_out_entry_description_check" CHECK(length("in_out_entry"."description") > 0),
	CONSTRAINT "in_out_entry_from_name_check" CHECK(length("in_out_entry"."from_name") > 0),
	CONSTRAINT "in_out_entry_from_kind_check" CHECK("in_out_entry"."from_kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "in_out_entry_from_shape_check" CHECK(("in_out_entry"."from_kind" = 'member' AND "in_out_entry"."from_user_id" IS NOT NULL) OR ("in_out_entry"."from_kind" = 'entity' AND "in_out_entry"."from_entity_id" IS NOT NULL) OR ("in_out_entry"."from_kind" = 'external')),
	CONSTRAINT "in_out_entry_status_check" CHECK("in_out_entry"."status" IN ('waiting', 'picked_up', 'moved_to_custodian')),
	CONSTRAINT "in_out_entry_picked_up_shape_check" CHECK(("in_out_entry"."status" = 'picked_up') = ("in_out_entry"."picked_up_at" IS NOT NULL AND "in_out_entry"."picked_up_by_name" IS NOT NULL AND "in_out_entry"."picked_up_by_kind" IS NOT NULL)),
	CONSTRAINT "in_out_entry_picked_up_by_kind_check" CHECK("in_out_entry"."picked_up_by_kind" IS NULL OR "in_out_entry"."picked_up_by_kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "in_out_entry_moved_shape_check" CHECK(("in_out_entry"."status" = 'moved_to_custodian') = ("in_out_entry"."custody_packet_id" IS NOT NULL AND "in_out_entry"."moved_to_custodian_at" IS NOT NULL)),
	CONSTRAINT "in_out_entry_identity_checked_check" CHECK("in_out_entry"."identity_checked" IS NULL OR "in_out_entry"."identity_checked" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `in_out_entry_number_unique_index` ON `in_out_entry` (`number`);--> statement-breakpoint
CREATE INDEX `in_out_entry_status_dropped_off_at_index` ON `in_out_entry` (`status`,`dropped_off_at`,`id`);--> statement-breakpoint
CREATE INDEX `in_out_entry_dropped_off_at_index` ON `in_out_entry` (`dropped_off_at`,`id`);--> statement-breakpoint
CREATE INDEX `in_out_entry_matter_index` ON `in_out_entry` (`matter_id`);--> statement-breakpoint
CREATE INDEX `in_out_entry_custody_packet_index` ON `in_out_entry` (`custody_packet_id`);--> statement-breakpoint
CREATE TABLE `in_out_entry_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`entry_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`entry_id`) REFERENCES `in_out_entry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `in_out_entry_number_allocation_entry_index` ON `in_out_entry_number_allocation` (`entry_id`);--> statement-breakpoint
CREATE TABLE `in_out_entry_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL,
	CONSTRAINT "in_out_entry_number_counter_next_value_check" CHECK("in_out_entry_number_counter"."next_value" > 0)
);
--> statement-breakpoint
CREATE TABLE `in_out_entry_recipient` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`entity_id` text,
	`name` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `in_out_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "in_out_entry_recipient_name_check" CHECK(length("in_out_entry_recipient"."name") > 0),
	CONSTRAINT "in_out_entry_recipient_kind_check" CHECK("in_out_entry_recipient"."kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "in_out_entry_recipient_shape_check" CHECK(("in_out_entry_recipient"."kind" = 'member' AND "in_out_entry_recipient"."user_id" IS NOT NULL) OR ("in_out_entry_recipient"."kind" = 'entity' AND "in_out_entry_recipient"."entity_id" IS NOT NULL) OR ("in_out_entry_recipient"."kind" = 'external'))
);
--> statement-breakpoint
CREATE INDEX `in_out_entry_recipient_entry_index` ON `in_out_entry_recipient` (`entry_id`,`position`);--> statement-breakpoint
CREATE INDEX `in_out_entry_recipient_user_index` ON `in_out_entry_recipient` (`user_id`);--> statement-breakpoint
CREATE INDEX `in_out_entry_recipient_entity_index` ON `in_out_entry_recipient` (`entity_id`);--> statement-breakpoint
-- Who may read the In/Out Log, and who may record at the front desk. Reading is every role, the
-- Read-only seat included: "is there something waiting for Ms Alvarez" is a question anybody who
-- answers the door has to be able to answer. Recording a drop off or a pick up is every role that
-- works with clients and their papers, which is all but Read-only.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'inOutLog:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'inOutLog:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'inOutLog:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutReadBilling00000', 'role_hwwC1D98d8Lazc_asL6vO', 'inOutLog:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutReadReadOnly0000', 'role_WojF9F7kksBEftsmZGNhb', 'inOutLog:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutManageOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'inOutLog:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutManageAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'inOutLog:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutManageParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'inOutLog:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_inOutManageBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'inOutLog:manage');
--> statement-breakpoint
-- The picture of the ID a person showed at pick up (owner, 2026-11-20): at most one per entry.
CREATE TABLE `in_out_identity_scan` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_pixels` integer NOT NULL,
	`height_pixels` integer NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `in_out_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "in_out_identity_scan_content_type_check" CHECK("in_out_identity_scan"."content_type" IN ('image/png', 'image/jpeg')),
	CONSTRAINT "in_out_identity_scan_size_check" CHECK("in_out_identity_scan"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `in_out_identity_scan_entry_unique_index` ON `in_out_identity_scan` (`entry_id`);
