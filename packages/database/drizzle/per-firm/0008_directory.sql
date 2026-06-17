CREATE TABLE `directory_address` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`label` text,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`country` text,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_address_is_primary_check" CHECK("directory_address"."is_primary" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `directory_address_entity_id_index` ON `directory_address` (`entity_id`);--> statement-breakpoint
CREATE TABLE `directory_category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`applies_to` text DEFAULT 'both' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "directory_category_name_nonempty_check" CHECK(length("directory_category"."name") > 0),
	CONSTRAINT "directory_category_applies_to_check" CHECK("directory_category"."applies_to" IN ('person', 'organization', 'both')),
	CONSTRAINT "directory_category_archived_check" CHECK("directory_category"."archived" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `directory_edge` (
	`id` text PRIMARY KEY NOT NULL,
	`from_entity_id` text NOT NULL,
	`to_entity_id` text NOT NULL,
	`edge_type` text NOT NULL,
	`role` text,
	`note` text,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_edge_edge_type_nonempty_check" CHECK(length("directory_edge"."edge_type") > 0)
);
--> statement-breakpoint
CREATE INDEX `directory_edge_from_entity_id_index` ON `directory_edge` (`from_entity_id`);--> statement-breakpoint
CREATE INDEX `directory_edge_to_entity_id_index` ON `directory_edge` (`to_entity_id`);--> statement-breakpoint
CREATE TABLE `directory_email` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`label` text,
	`address` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_email_address_nonempty_check" CHECK(length("directory_email"."address") > 0),
	CONSTRAINT "directory_email_is_primary_check" CHECK("directory_email"."is_primary" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `directory_email_entity_id_index` ON `directory_email` (`entity_id`);--> statement-breakpoint
CREATE TABLE `directory_entity_category` (
	`entity_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`entity_id`, `category_id`),
	FOREIGN KEY (`category_id`) REFERENCES `directory_category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `directory_identifier` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`identifier_type` text NOT NULL,
	`value_ciphertext` text NOT NULL,
	`value_blind_index` text,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_identifier_identifier_type_nonempty_check" CHECK(length("directory_identifier"."identifier_type") > 0)
);
--> statement-breakpoint
CREATE INDEX `directory_identifier_entity_id_index` ON `directory_identifier` (`entity_id`);--> statement-breakpoint
CREATE INDEX `directory_identifier_type_blind_index_index` ON `directory_identifier` (`identifier_type`,`value_blind_index`);--> statement-breakpoint
CREATE TABLE `directory_name` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`name_role` text NOT NULL,
	`name_prefix` text,
	`name_given` text,
	`name_middle` text,
	`name_family` text,
	`name_suffix` text,
	`normalized_display` text NOT NULL,
	`is_current` integer DEFAULT 1 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_name_entity_kind_check" CHECK("directory_name"."entity_kind" IN ('person', 'organization')),
	CONSTRAINT "directory_name_name_role_check" CHECK(length("directory_name"."name_role") > 0),
	CONSTRAINT "directory_name_is_current_check" CHECK("directory_name"."is_current" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `directory_name_entity_id_index` ON `directory_name` (`entity_id`);--> statement-breakpoint
CREATE INDEX `directory_name_normalized_display_index` ON `directory_name` (`normalized_display`);--> statement-breakpoint
CREATE TABLE `directory_name_phonetic_code` (
	`name_id` text NOT NULL,
	`scheme` text NOT NULL,
	`code` text NOT NULL,
	PRIMARY KEY(`name_id`, `scheme`),
	FOREIGN KEY (`name_id`) REFERENCES `directory_name`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "directory_name_phonetic_code_scheme_check" CHECK(length("directory_name_phonetic_code"."scheme") > 0)
);
--> statement-breakpoint
CREATE INDEX `directory_name_phonetic_code_scheme_code_index` ON `directory_name_phonetic_code` (`scheme`,`code`);--> statement-breakpoint
CREATE TABLE `directory_organization` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text,
	`display_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_organization_status_check" CHECK("directory_organization"."status" IN ('active', 'merged_into'))
);
--> statement-breakpoint
CREATE TABLE `directory_party_role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "directory_party_role_name_nonempty_check" CHECK(length("directory_party_role"."name") > 0),
	CONSTRAINT "directory_party_role_archived_check" CHECK("directory_party_role"."archived" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `directory_party_role_name_unique_index` ON `directory_party_role` (`name`);--> statement-breakpoint
CREATE TABLE `directory_person` (
	`id` text PRIMARY KEY NOT NULL,
	`name_prefix` text,
	`name_given` text,
	`name_middle` text,
	`name_family` text,
	`name_suffix` text,
	`display_name` text,
	`member_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_person_status_check" CHECK("directory_person"."status" IN ('active', 'merged_into'))
);
--> statement-breakpoint
CREATE TABLE `directory_phone` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`label` text,
	`number` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_phone_number_nonempty_check" CHECK(length("directory_phone"."number") > 0),
	CONSTRAINT "directory_phone_is_primary_check" CHECK("directory_phone"."is_primary" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `directory_phone_entity_id_index` ON `directory_phone` (`entity_id`);--> statement-breakpoint
CREATE TABLE `entity_merge` (
	`id` text PRIMARY KEY NOT NULL,
	`master_id` text NOT NULL,
	`subordinate_id` text NOT NULL,
	`survivorship` text,
	`repointed` text,
	`merged_at` text NOT NULL,
	`merged_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `matter_party` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_party_role_nonempty_check" CHECK(length("matter_party"."role") > 0)
);
--> statement-breakpoint
CREATE INDEX `matter_party_matter_id_index` ON `matter_party` (`matter_id`);--> statement-breakpoint
CREATE INDEX `matter_party_entity_id_index` ON `matter_party` (`entity_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `directory_name_fts` USING fts5(normalized_display, content='directory_name', content_rowid='rowid', tokenize='trigram');--> statement-breakpoint
CREATE TRIGGER `directory_name_fts_insert` AFTER INSERT ON `directory_name` BEGIN
  INSERT INTO `directory_name_fts`(rowid, normalized_display) VALUES (new.rowid, new.normalized_display);
END;--> statement-breakpoint
CREATE TRIGGER `directory_name_fts_delete` AFTER DELETE ON `directory_name` BEGIN
  INSERT INTO `directory_name_fts`(`directory_name_fts`, rowid, normalized_display) VALUES ('delete', old.rowid, old.normalized_display);
END;--> statement-breakpoint
CREATE TRIGGER `directory_name_fts_update` AFTER UPDATE ON `directory_name` BEGIN
  INSERT INTO `directory_name_fts`(`directory_name_fts`, rowid, normalized_display) VALUES ('delete', old.rowid, old.normalized_display);
  INSERT INTO `directory_name_fts`(rowid, normalized_display) VALUES (new.rowid, new.normalized_display);
END;