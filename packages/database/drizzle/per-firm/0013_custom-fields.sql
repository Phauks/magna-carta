CREATE TABLE `custom_field` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`attachment_id` text,
	`number_scale` integer,
	`required` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`converting` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`template_field_key` text,
	`created_at` text NOT NULL,
	`created_by` text,
	CONSTRAINT "custom_field_kind_check" CHECK(`kind` IN ('checkbox','date','time','number','currency','picklist','single-line','multi-line','url','email','matter-reference','contact-reference')),
	CONSTRAINT "custom_field_target_check" CHECK(`target` IN ('matter','entity')),
	CONSTRAINT "custom_field_required_check" CHECK(`required` IN (0,1)),
	CONSTRAINT "custom_field_archived_check" CHECK(`archived` IN (0,1)),
	CONSTRAINT "custom_field_converting_check" CHECK(`converting` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `custom_field_scope_index` ON `custom_field` (`target`, `attachment_id`);--> statement-breakpoint
CREATE TABLE `picklist_option` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "picklist_option_archived_check" CHECK(`archived` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `picklist_option_field_id_index` ON `picklist_option` (`field_id`);--> statement-breakpoint
CREATE TABLE `custom_field_value` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`target_row_id` text NOT NULL,
	`value_text` text,
	`value_number` integer,
	`value_date` text,
	`value_option_id` text,
	`value_reference_id` text,
	`is_current` integer DEFAULT 1 NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	`created_by` text,
	CONSTRAINT "custom_field_value_is_current_check" CHECK(`is_current` IN (0,1)),
	CONSTRAINT "custom_field_value_one_value_check" CHECK(
		(`value_text` IS NOT NULL) + (`value_number` IS NOT NULL) + (`value_date` IS NOT NULL) + (`value_option_id` IS NOT NULL) + (`value_reference_id` IS NOT NULL) = 1
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_value_current_unique_index` ON `custom_field_value` (`target_row_id`, `field_id`) WHERE `is_current` = 1;--> statement-breakpoint
CREATE INDEX `custom_field_value_record_index` ON `custom_field_value` (`target_row_id`, `is_current`);--> statement-breakpoint
CREATE INDEX `custom_field_value_field_index` ON `custom_field_value` (`field_id`);--> statement-breakpoint
CREATE INDEX `custom_field_value_reference_index` ON `custom_field_value` (`value_reference_id`);--> statement-breakpoint
-- Seed customFields:manage and customFields:purge onto the Owner/Admin role. The role_id below is
-- the single combined Owner/Admin role seeded in the member-rbac migration; the rolePermission_
-- handles were minted once and committed as literals so every firm's defaults match byte-for-byte.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES
	('rolePermission_cf1ManageOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'customFields:manage'),
	('rolePermission_cf2PurgeOwnerAdmin000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'customFields:purge');
