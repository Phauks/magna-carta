CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`actor_user_id` text,
	`subject_id` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_index` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_event_index` ON `audit_log` (`event`);--> statement-breakpoint
CREATE TABLE `document_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "document_type_name_nonempty_check" CHECK(length("document_type"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_type_name_unique_index` ON `document_type` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_type_code_unique_index` ON `document_type` (`code`);--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`document_type_id` text,
	`current_version_id` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_type_id`) REFERENCES `document_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_name_nonempty_check" CHECK(length("file"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `file_matter_id_index` ON `file` (`matter_id`);--> statement-breakpoint
CREATE INDEX `file_folder_id_index` ON `file` (`folder_id`);--> statement-breakpoint
CREATE TABLE `file_version` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer,
	`declared_content_type` text,
	`sniffed_content_type` text,
	`content_sha256` text,
	`storage_encoding` text DEFAULT 'full' NOT NULL,
	`artifact_role` text DEFAULT 'original' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`storage_class` text DEFAULT 'standard' NOT NULL,
	`scan_verdict` text,
	`scan_engine_version` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	`committed_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_version_artifact_role_check" CHECK("file_version"."artifact_role" IN ('original', 'derived')),
	CONSTRAINT "file_version_storage_class_check" CHECK("file_version"."storage_class" IN ('standard', 'infrequent_access')),
	CONSTRAINT "file_version_scan_verdict_check" CHECK("file_version"."scan_verdict" IS NULL OR "file_version"."scan_verdict" IN ('unscanned', 'clean', 'infected')),
	CONSTRAINT "file_version_status_check" CHECK("file_version"."status" IN ('pending', 'clean', 'quarantined', 'abandoned')),
	CONSTRAINT "file_version_size_bytes_nonneg_check" CHECK("file_version"."size_bytes" IS NULL OR "file_version"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_r2_key_unique_index` ON `file_version` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_file_id_version_number_unique_index` ON `file_version` (`file_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `file_version_status_index` ON `file_version` (`status`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`parent_folder_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "folder_name_nonempty_check" CHECK(length("folder"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `folder_matter_id_index` ON `folder` (`matter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folder_matter_id_parent_folder_id_name_unique` ON `folder` (`matter_id`,`parent_folder_id`,`name`);--> statement-breakpoint
CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`jurisdiction` text,
	`number_code` text,
	`address_block` text,
	`footer` text,
	`remit_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "location_status_check" CHECK("location"."status" IN ('active', 'closed')),
	CONSTRAINT "location_name_nonempty_check" CHECK(length("location"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_number_code_unique_index` ON `location` (`number_code`);--> statement-breakpoint
CREATE TABLE `location_address` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`phone` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "location_address_kind_check" CHECK("location_address"."kind" IN ('physical', 'mailing'))
);
--> statement-breakpoint
CREATE INDEX `location_address_location_id_index` ON `location_address` (`location_id`);--> statement-breakpoint
CREATE TABLE `matter` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`matter_type_id` text,
	`location_id` text,
	`responsible_member_id` text NOT NULL,
	`client_display_name` text,
	`client_code` text,
	`matter_number` text,
	`numbered_at` text,
	`opened_at` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_status_check" CHECK("matter"."status" IN ('prospective', 'open', 'closed')),
	CONSTRAINT "matter_title_nonempty_check" CHECK(length("matter"."title") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_matter_number_unique_index` ON `matter` (`matter_number`) WHERE "matter"."matter_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `matter_status_index` ON `matter` (`status`);--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_index` ON `matter` (`responsible_member_id`);--> statement-breakpoint
CREATE TABLE `matter_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `matter_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_type_name_nonempty_check" CHECK(length("matter_type"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_type_name_unique_index` ON `matter_type` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `matter_type_code_unique_index` ON `matter_type` (`code`);--> statement-breakpoint
CREATE TABLE `member_location` (
	`id` text PRIMARY KEY NOT NULL,
	`member_user_id` text NOT NULL,
	`location_id` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_location_location_id_index` ON `member_location` (`location_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_location_member_user_id_location_id_unique` ON `member_location` (`member_user_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `numbering_scheme` (
	`id` text PRIMARY KEY NOT NULL,
	`segments` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `storage_meter` (
	`storage_class` text NOT NULL,
	`artifact_role` text NOT NULL,
	`prefix` text NOT NULL,
	`bytes` integer NOT NULL,
	`object_count` integer NOT NULL,
	PRIMARY KEY(`storage_class`, `artifact_role`, `prefix`)
);
--> statement-breakpoint
CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`file_version_id` text NOT NULL,
	`mode` text NOT NULL,
	`r2_upload_id` text,
	`declared_size` integer,
	`declared_content_type` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_session_mode_check" CHECK("upload_session"."mode" IN ('put', 'multipart')),
	CONSTRAINT "upload_session_status_check" CHECK("upload_session"."status" IN ('open', 'completed', 'aborted', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `upload_session_status_expires_at_index` ON `upload_session` (`status`,`expires_at`);--> statement-breakpoint
-- Default-role grants for the matters/locations/files permissions (extending the 0002 role seeds).
-- rolePermission ids are pre-generated with @magna-carta/identifiers and committed as literals so
-- every firm's defaults match byte-for-byte. Permission values are registry keys from
-- @magna-carta/access-control; the seed-vs-registry fitness test cross-checks each. Distribution:
-- Owner/Admin gets all new permissions; Attorney gets matters create/open/close/edit + files
-- upload/organize/delete; Paralegal gets matters:create + files upload/organize; Billing and
-- Read-only get none. Roles are adjustable data.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_R50ydXlOD-szeHUI16fRm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:create');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_eUh-wBCG4tllOHcZjgN1z', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:open');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_QgtEgajET5PdlFyvVb9-b', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:close');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mO7X_wgJU_IZqZvzmgVDj', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:reopen');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_DKPoMjLHEexGVPxJwZVmG', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:edit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_HlZfZnyK_-6GtO7CEWwe0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:renumber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_kAYpEKy9TxxcWkdjjGPGz', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:manageTypes');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_ossj_fXCyLnKP7Hcm-dQz', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:manageNumbering');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_N9Es0aSITB-IosKfzZLuO', 'role_Gw-zKO8hOHQuNv2bWokMp', 'locations:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_JtQITveEDYoyzggKv160N', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:upload');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_5D8f_IJMNtdrKmMXInDiT', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:organize');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_n_TyLTzre42ToQQPlVz4o', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:delete');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_BRL7AX95F8Z0JQjZXsr8z', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:manageDocumentTypes');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_0ZIYDm7yo1-EM1XmP-wp1', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:create');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_QDmTPyP9n2T7PaONM8TH4', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:open');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_X5r2xbNOYp-1JR3TEt-Qy', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:close');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_SP5jz8iTyncPVaMYz-uHb', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:edit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Xeo0sUbEaI9hX_RYRw_Ko', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:upload');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_OKER3B_1wG2nUTXZixegp', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:organize');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_X-s52_1SXPkLxC9QCgs8O', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:delete');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_vwbI5VZ5l-6Iu4DU9NAs9', 'role_917LCQyRKP50Z9bW89vXl', 'matters:create');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_6R_8QpzVF9pTPhsKyXgTI', 'role_917LCQyRKP50Z9bW89vXl', 'files:upload');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_zAvgogzr0p1bVxZCXZly1', 'role_917LCQyRKP50Z9bW89vXl', 'files:organize');
