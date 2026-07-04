CREATE TABLE `account_balance` (
	`account_id` text PRIMARY KEY NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`min_balance_minor` integer,
	`max_balance_minor` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_balance_bounds_check" CHECK(("account_balance"."min_balance_minor" IS NULL OR "account_balance"."balance_minor" >= "account_balance"."min_balance_minor") AND ("account_balance"."max_balance_minor" IS NULL OR "account_balance"."balance_minor" <= "account_balance"."max_balance_minor"))
);
--> statement-breakpoint
CREATE TABLE `ai_detection_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_by` text NOT NULL,
	`word_count` integer NOT NULL,
	`mode` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`adapter_id` text NOT NULL,
	`vendor_version` text,
	`result_band` text,
	`matter_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_detection_usage_created_at_index` ON `ai_detection_usage` (`created_at`);--> statement-breakpoint
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
CREATE TABLE `cost_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`vendor_id` text,
	`incurred_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`disbursement_class` text NOT NULL,
	`billable` integer NOT NULL,
	`utbms_expense_code_id` text,
	`description` text DEFAULT '' NOT NULL,
	`receipt_file_id` text,
	`status` text NOT NULL,
	`kick_back_reason` text,
	`source` text NOT NULL,
	`recovery_category` text,
	`recovery_ref` text,
	`invoice_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utbms_expense_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cost_entry_disbursement_class_check" CHECK("cost_entry"."disbursement_class" IN ('hard','soft')),
	CONSTRAINT "cost_entry_status_check" CHECK("cost_entry"."status" IN ('draft','submitted','approved','billed','void')),
	CONSTRAINT "cost_entry_source_check" CHECK("cost_entry"."source" IN ('manual','grid','recovery')),
	CONSTRAINT "cost_entry_billable_check" CHECK("cost_entry"."billable" IN (0,1)),
	CONSTRAINT "cost_entry_currency_check" CHECK("cost_entry"."currency" IN ('USD'))
);
--> statement-breakpoint
CREATE INDEX `cost_entry_matter_status_index` ON `cost_entry` (`matter_id`,`status`);--> statement-breakpoint
CREATE INDEX `cost_entry_status_incurred_date_index` ON `cost_entry` (`status`,`incurred_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_entry_recovery_ref_unique` ON `cost_entry` (`recovery_ref`) WHERE "cost_entry"."recovery_ref" IS NOT NULL;--> statement-breakpoint
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
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `custom_field_scope_index` ON `custom_field` (`target`,`attachment_id`);--> statement-breakpoint
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
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_value_current_unique_index` ON `custom_field_value` (`target_row_id`,`field_id`) WHERE "custom_field_value"."is_current" = 1;--> statement-breakpoint
CREATE INDEX `custom_field_value_record_index` ON `custom_field_value` (`target_row_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `custom_field_value_field_index` ON `custom_field_value` (`field_id`);--> statement-breakpoint
CREATE INDEX `custom_field_value_reference_index` ON `custom_field_value` (`value_reference_id`);--> statement-breakpoint
CREATE TABLE `direct_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`member_user_id` text NOT NULL,
	`permission` text NOT NULL,
	`expires_at` text,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `direct_grant_member_user_id_index` ON `direct_grant` (`member_user_id`);--> statement-breakpoint
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
CREATE INDEX `directory_name_phonetic_code_code_index` ON `directory_name_phonetic_code` (`code`);--> statement-breakpoint
CREATE TABLE `directory_organization` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text,
	`display_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`needs_review` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_organization_status_check" CHECK("directory_organization"."status" IN ('active', 'merged_into')),
	CONSTRAINT "directory_organization_needs_review_check" CHECK("directory_organization"."needs_review" IN (0, 1))
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
	`needs_review` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "directory_person_status_check" CHECK("directory_person"."status" IN ('active', 'merged_into')),
	CONSTRAINT "directory_person_needs_review_check" CHECK("directory_person"."needs_review" IN (0, 1))
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
CREATE TABLE `document_checkout` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`holder_member_id` text NOT NULL,
	`lock_type` text NOT NULL,
	`base_version_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`idle_release_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holder_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_checkout_lock_type_check" CHECK("document_checkout"."lock_type" IN ('exclusive', 'offline_working_copy')),
	CONSTRAINT "document_checkout_status_check" CHECK("document_checkout"."status" IN ('active', 'stale', 'released', 'reconciling'))
);
--> statement-breakpoint
CREATE INDEX `document_checkout_file_id_index` ON `document_checkout` (`file_id`);--> statement-breakpoint
CREATE INDEX `document_checkout_holder_member_id_index` ON `document_checkout` (`holder_member_id`);--> statement-breakpoint
CREATE INDEX `document_checkout_status_last_activity_index` ON `document_checkout` (`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `document_checkout_status_idle_release_index` ON `document_checkout` (`status`,`idle_release_at`);--> statement-breakpoint
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
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`document_type_id` text,
	`current_version_id` text,
	`current_r2_key` text,
	`current_sha256` text,
	`current_size_bytes` integer,
	`current_wopi_timestamp` text,
	`edit_state` text DEFAULT 'idle' NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_type_id`) REFERENCES `document_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_name_nonempty_check" CHECK(length("file"."name") > 0),
	CONSTRAINT "file_edit_state_check" CHECK("file"."edit_state" IN ('idle', 'coediting', 'checked_out'))
);
--> statement-breakpoint
CREATE INDEX `file_matter_id_created_at_id_index` ON `file` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `file_folder_id_created_at_id_index` ON `file` (`folder_id`,`created_at`,`id`);--> statement-breakpoint
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
	`scan_detail` text,
	`inline_playable` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text,
	`reconciliation_status` text DEFAULT 'clean' NOT NULL,
	`diverged_from_version_id` text,
	`checkout_id` text,
	`created_at` text NOT NULL,
	`committed_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diverged_from_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkout_id`) REFERENCES `document_checkout`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_version_artifact_role_check" CHECK("file_version"."artifact_role" IN ('original', 'derived')),
	CONSTRAINT "file_version_storage_class_check" CHECK("file_version"."storage_class" IN ('standard', 'infrequent_access')),
	CONSTRAINT "file_version_scan_verdict_check" CHECK("file_version"."scan_verdict" IS NULL OR "file_version"."scan_verdict" IN ('unscanned', 'clean', 'flagged')),
	CONSTRAINT "file_version_inline_playable_check" CHECK("file_version"."inline_playable" IS NULL OR "file_version"."inline_playable" IN ('playable', 'download-only', 'indeterminate')),
	CONSTRAINT "file_version_status_check" CHECK("file_version"."status" IN ('pending', 'clean', 'quarantined', 'abandoned')),
	CONSTRAINT "file_version_reconciliation_status_check" CHECK("file_version"."reconciliation_status" IN ('clean', 'conflict_pending', 'reconciled')),
	CONSTRAINT "file_version_size_bytes_nonneg_check" CHECK("file_version"."size_bytes" IS NULL OR "file_version"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_r2_key_unique_index` ON `file_version` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_file_id_version_number_unique_index` ON `file_version` (`file_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `file_version_status_index` ON `file_version` (`status`);--> statement-breakpoint
CREATE INDEX `file_version_tiering_index` ON `file_version` (`storage_class`,`status`,`committed_at`);--> statement-breakpoint
CREATE TABLE `firm_secret` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_secret_name_unique` ON `firm_secret` (`name`);--> statement-breakpoint
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
CREATE INDEX `folder_matter_id_created_at_id_index` ON `folder` (`matter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folder_matter_id_parent_folder_id_name_unique` ON `folder` (`matter_id`,`parent_folder_id`,`name`);--> statement-breakpoint
CREATE TABLE `idempotency_key` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`response_code` integer,
	`response_body` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_key_key_unique_index` ON `idempotency_key` (`key`);--> statement-breakpoint
CREATE INDEX `idempotency_key_created_at_index` ON `idempotency_key` (`created_at`);--> statement-breakpoint
CREATE TABLE `incident` (
	`id` text PRIMARY KEY NOT NULL,
	`error_ids` text NOT NULL,
	`breadcrumbs` text NOT NULL,
	`description` text,
	`description_ciphertext` text,
	`context` text NOT NULL,
	`screenshot_key` text,
	`status` text DEFAULT 'open' NOT NULL,
	`reported_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`adapter_id` text NOT NULL,
	`scope` text NOT NULL,
	`principal_ref` text NOT NULL,
	`credential_ref` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`capability_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connection_principal_category_unique_index` ON `integration_connection` (`category`,`principal_ref`);--> statement-breakpoint
CREATE TABLE `ledger_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`parent_account_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_account_name_nonempty_check" CHECK(length("ledger_account"."name") > 0),
	CONSTRAINT "ledger_account_type_check" CHECK("ledger_account"."type" IN ('asset', 'liability', 'equity', 'income', 'expense'))
);
--> statement-breakpoint
CREATE INDEX `ledger_account_parent_account_id_index` ON `ledger_account` (`parent_account_id`);--> statement-breakpoint
CREATE TABLE `ledger_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	`reverses_entry_id` text,
	FOREIGN KEY (`reverses_entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_entry_description_nonempty_check" CHECK(length("ledger_entry"."description") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entry_reverses_entry_id_unique_index` ON `ledger_entry` (`reverses_entry_id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_effective_date_index` ON `ledger_entry` (`effective_date`);--> statement-breakpoint
CREATE TABLE `ledger_line` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_line_amount_minor_positive_check" CHECK("ledger_line"."amount_minor" > 0),
	CONSTRAINT "ledger_line_direction_check" CHECK("ledger_line"."direction" IN ('debit', 'credit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_line_entry_id_line_index_unique_index` ON `ledger_line` (`entry_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `ledger_line_account_id_index` ON `ledger_line` (`account_id`);--> statement-breakpoint
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
	`e_billing` integer DEFAULT 0 NOT NULL,
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
	CONSTRAINT "matter_title_nonempty_check" CHECK(length("matter"."title") > 0),
	CONSTRAINT "matter_e_billing_check" CHECK("matter"."e_billing" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_matter_number_unique_index` ON `matter` (`matter_number`) WHERE "matter"."matter_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `matter_status_index` ON `matter` (`status`);--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_created_at_id_index` ON `matter` (`responsible_member_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matter_created_at_id_index` ON `matter` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `matter_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
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
CREATE TABLE `member` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`opted_out_of_usage_analytics` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `member_role` (
	`id` text PRIMARY KEY NOT NULL,
	`member_user_id` text NOT NULL,
	`role_id` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_role_member_user_id_role_id_unique` ON `member_role` (`member_user_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `narrative_template` (
	`id` text PRIMARY KEY NOT NULL,
	`utbms_task_code_id` text,
	`narrative_template` text NOT NULL,
	`default_rate_e4` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`utbms_task_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `narrative_template_utbms_task_code_index` ON `narrative_template` (`utbms_task_code_id`);--> statement-breakpoint
CREATE TABLE `non_billable_category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "non_billable_category_name_nonempty_check" CHECK(length("non_billable_category"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE `numbering_scheme` (
	`id` text PRIMARY KEY NOT NULL,
	`segments` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`payload` text NOT NULL,
	`aggregate_key` text,
	`seq` integer,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`dispatched_at` text
);
--> statement-breakpoint
CREATE INDEX `outbox_status_created_at_index` ON `outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `picklist_option` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `picklist_option_field_id_index` ON `picklist_option` (`field_id`);--> statement-breakpoint
CREATE TABLE `rate` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_card_id` text NOT NULL,
	`tier` text NOT NULL,
	`scoped_id` text,
	`rate_e4` integer NOT NULL,
	`currency` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rate_card_id`) REFERENCES `rate_card`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rate_tier_check" CHECK("rate"."tier" IN ('matter', 'client', 'timekeeper', 'role')),
	CONSTRAINT "rate_currency_check" CHECK("rate"."currency" IN ('USD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_open_row_unique_index` ON `rate` (`rate_card_id`,`tier`,`scoped_id`) WHERE "rate"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX `rate_resolution_index` ON `rate` (`rate_card_id`,`tier`,`scoped_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `rate_card` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "rate_card_name_nonempty_check" CHECK(length("rate_card"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE `role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_name_unique` ON `role` (`name`);--> statement-breakpoint
CREATE TABLE `role_permission` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permission_role_id_permission_unique` ON `role_permission` (`role_id`,`permission`);--> statement-breakpoint
CREATE TABLE `scan_cache` (
	`content_sha256` text NOT NULL,
	`engine_version` text NOT NULL,
	`raw_result` text NOT NULL,
	`scanned_at` text NOT NULL,
	PRIMARY KEY(`content_sha256`, `engine_version`)
);
--> statement-breakpoint
CREATE TABLE `scoped_setting` (
	`key` text NOT NULL,
	`scope_tier` text NOT NULL,
	`scoped_id` text,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`key`, `scope_tier`, `scoped_id`),
	CONSTRAINT "scoped_setting_scope_tier_check" CHECK("scoped_setting"."scope_tier" IN ('matter', 'client', 'user', 'location', 'firm'))
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shipment` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_ref` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`parcel` text NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`remote_shipment_id` text,
	`carrier` text,
	`service` text,
	`tracking_code` text,
	`label_ref` text,
	`postage_cost_minor` integer,
	`service_fee_minor` integer,
	`currency` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_ref`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shipment_matter_ref_index` ON `shipment` (`matter_ref`);--> statement-breakpoint
CREATE INDEX `shipment_tracking_code_index` ON `shipment` (`tracking_code`);--> statement-breakpoint
CREATE TABLE `shipment_label` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_ref` text NOT NULL,
	`format` text NOT NULL,
	`r2_key` text NOT NULL,
	`tracking_code` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`voided` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_ref`) REFERENCES `shipment`(`id`) ON UPDATE no action ON DELETE no action
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
CREATE TABLE `time_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`timekeeper_user_id` text NOT NULL,
	`work_date` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`raw_duration_minutes` integer NOT NULL,
	`narrative` text NOT NULL,
	`billable` integer NOT NULL,
	`non_billable_category_id` text,
	`currency` text NOT NULL,
	`rate_e4` integer,
	`rate_card_id` text,
	`rate_source` text,
	`amount_minor` integer,
	`utbms_task_code_id` text,
	`utbms_activity_code_id` text,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`live_run_id` text,
	`invoice_id` text,
	`kick_back_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`timekeeper_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`non_billable_category_id`) REFERENCES `non_billable_category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_card_id`) REFERENCES `rate_card`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utbms_task_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utbms_activity_code_id`) REFERENCES `utbms_code`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_entry_billable_check" CHECK("time_entry"."billable" IN (0, 1)),
	CONSTRAINT "time_entry_status_check" CHECK("time_entry"."status" IN ('draft', 'submitted', 'approved', 'billed', 'void')),
	CONSTRAINT "time_entry_source_check" CHECK("time_entry"."source" IN ('timer', 'manual', 'quick_add', 'grid', 'offline_sync', 'calendar')),
	CONSTRAINT "time_entry_rate_source_check" CHECK("time_entry"."rate_source" IS NULL OR "time_entry"."rate_source" IN ('override', 'matter', 'client', 'timekeeper', 'role', 'card_default')),
	CONSTRAINT "time_entry_currency_check" CHECK("time_entry"."currency" IN ('USD')),
	CONSTRAINT "time_entry_amount_paired_null_check" CHECK(("time_entry"."amount_minor" IS NULL) = ("time_entry"."rate_e4" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `time_entry_timekeeper_work_date_index` ON `time_entry` (`timekeeper_user_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `time_entry_matter_status_index` ON `time_entry` (`matter_id`,`status`);--> statement-breakpoint
CREATE INDEX `time_entry_status_work_date_index` ON `time_entry` (`status`,`work_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_live_run_id_unique_index` ON `time_entry` (`live_run_id`) WHERE "time_entry"."live_run_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `token_usage_meter` (
	`day` text NOT NULL,
	`slot` text NOT NULL,
	`model_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`request_count` integer NOT NULL,
	PRIMARY KEY(`day`, `slot`, `model_id`)
);
--> statement-breakpoint
CREATE TABLE `tracking_event` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_ref` text NOT NULL,
	`remote_id` text NOT NULL,
	`status` text NOT NULL,
	`occurred_at` text,
	`location` text,
	`message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_ref`) REFERENCES `shipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_event_shipment_remote_unique_index` ON `tracking_event` (`shipment_ref`,`remote_id`);--> statement-breakpoint
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
CREATE TABLE `utbms_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code_set` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`practice_area` text,
	`active` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "utbms_code_set_check" CHECK("utbms_code"."code_set" IN ('task', 'activity', 'expense')),
	CONSTRAINT "utbms_code_active_check" CHECK("utbms_code"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `utbms_code_code_set_code_unique` ON `utbms_code` (`code_set`,`code`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `directory_name_fts` USING fts5(normalized_display, content='directory_name', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `directory_name_fts_insert` AFTER INSERT ON `directory_name` BEGIN
  INSERT INTO `directory_name_fts`(rowid, normalized_display) VALUES (new.rowid, new.normalized_display);
END;
--> statement-breakpoint
CREATE TRIGGER `directory_name_fts_delete` AFTER DELETE ON `directory_name` BEGIN
  INSERT INTO `directory_name_fts`(`directory_name_fts`, rowid, normalized_display) VALUES ('delete', old.rowid, old.normalized_display);
END;
--> statement-breakpoint
CREATE TRIGGER `directory_name_fts_update` AFTER UPDATE ON `directory_name` BEGIN
  INSERT INTO `directory_name_fts`(`directory_name_fts`, rowid, normalized_display) VALUES ('delete', old.rowid, old.normalized_display);
  INSERT INTO `directory_name_fts`(rowid, normalized_display) VALUES (new.rowid, new.normalized_display);
END;
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('role_Gw-zKO8hOHQuNv2bWokMp', 'Owner/Admin', '2026-06-10T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('role_gEyJ_YqL1_RI_yDqSa28Y', 'Attorney', '2026-06-10T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('role_917LCQyRKP50Z9bW89vXl', 'Paralegal', '2026-06-10T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('role_hwwC1D98d8Lazc_asL6vO', 'Billing', '2026-06-10T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role` (`id`, `name`, `created_at`) VALUES ('role_WojF9F7kksBEftsmZGNhb', 'Read-only', '2026-06-10T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bjqp0FuxHVqfwweoS4lNd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageMembers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_J_VyO7k3_3vtHilg3W6_C', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:reportIncident');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_BEmU6-yJ-oxxRgiKej09M', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:reportIncident');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tV_NzqUOofB1b3KhRBWau', 'role_917LCQyRKP50Z9bW89vXl', 'firm:reportIncident');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_aiznofBuFRS1JUUjHVB4N', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:reportIncident');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_dL4NdTy1qANtzn2SihyGJ', 'role_WojF9F7kksBEftsmZGNhb', 'firm:reportIncident');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_R50ydXlOD-szeHUI16fRm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:create');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_eUh-wBCG4tllOHcZjgN1z', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:open');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_QgtEgajET5PdlFyvVb9-b', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:close');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mO7X_wgJU_IZqZvzmgVDj', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:reopen');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_DKPoMjLHEexGVPxJwZVmG', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_HlZfZnyK_-6GtO7CEWwe0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:renumber');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_kAYpEKy9TxxcWkdjjGPGz', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:manageTypes');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_ossj_fXCyLnKP7Hcm-dQz', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:manageNumbering');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_N9Es0aSITB-IosKfzZLuO', 'role_Gw-zKO8hOHQuNv2bWokMp', 'locations:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_JtQITveEDYoyzggKv160N', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:upload');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_5D8f_IJMNtdrKmMXInDiT', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:organize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_n_TyLTzre42ToQQPlVz4o', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:delete');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_BRL7AX95F8Z0JQjZXsr8z', 'role_Gw-zKO8hOHQuNv2bWokMp', 'files:manageDocumentTypes');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_0ZIYDm7yo1-EM1XmP-wp1', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:create');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_QDmTPyP9n2T7PaONM8TH4', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:open');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_X5r2xbNOYp-1JR3TEt-Qy', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:close');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_SP5jz8iTyncPVaMYz-uHb', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Xeo0sUbEaI9hX_RYRw_Ko', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:upload');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_OKER3B_1wG2nUTXZixegp', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:organize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_X-s52_1SXPkLxC9QCgs8O', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'files:delete');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_vwbI5VZ5l-6Iu4DU9NAs9', 'role_917LCQyRKP50Z9bW89vXl', 'matters:create');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_6R_8QpzVF9pTPhsKyXgTI', 'role_917LCQyRKP50Z9bW89vXl', 'files:upload');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_zAvgogzr0p1bVxZCXZly1', 'role_917LCQyRKP50Z9bW89vXl', 'files:organize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mS1kQ3mN8vX2pL5wR9tB7', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageSecrets');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_iV2dC4hT6yU8wE1rA3sD5', 'role_Gw-zKO8hOHQuNv2bWokMp', 'incidents:viewDescription');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_q7J6yK5CfA9O1vgyLizLh', 'role_Gw-zKO8hOHQuNv2bWokMp', 'shipping:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_dir1EditOwnerAdmin000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'directory:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_dir1EditAttorney00000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'directory:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_dir1ViewSensitiveIds0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'directory:viewSensitiveIdentifiers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ku9Tn3aWx7Lp0qRsVbE2c', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:firmUsage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_cf1ManageOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'customFields:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_cf2PurgeOwnerAdmin000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'customFields:purge');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Xm4Pq9rN2kLsDf7vWtB5E', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:whois');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Hn6Cs8uA3mGpEj1xYkV0R', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:whois');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Zt7Dw5bQ4nHrFk2yXgU9M', 'role_917LCQyRKP50Z9bW89vXl', 'tools:whois');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Lf3Ey6cR8oJsGn4zWiT1P', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:whois');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Qv2Fa7dS5pKtHm6aZjN8C', 'role_WojF9F7kksBEftsmZGNhb', 'tools:whois');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Rg8Gb1eT6qLuIn7bAkO3D', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:safeBrowse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Sh9Hc2fU7rMvJo8cBlP4E', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:safeBrowse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ti0Id3gV8sNwKp9dCmQ5F', 'role_917LCQyRKP50Z9bW89vXl', 'tools:safeBrowse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Uj1Je4hW9tOxLq0eDnR6G', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:safeBrowse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Vk2Kf5iX0uPyMr1fEoS7H', 'role_WojF9F7kksBEftsmZGNhb', 'tools:safeBrowse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_MXlkyBFqE6dla3oeldq3Z', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileConverter');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:scanFile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:scanFile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'firm:scanFile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:scanFile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_scanFileReadonly00', 'role_WojF9F7kksBEftsmZGNhb', 'firm:scanFile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ms3Yw8nK1qBp5tGxJcH0R', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:metadataScrubber');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Nf4Zv9oL2rCq6uHyKdI1S', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:metadataScrubber');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Og5Aw0pM3sDr7vIzLeJ2T', 'role_917LCQyRKP50Z9bW89vXl', 'tools:metadataScrubber');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ph6Bx1qN4tEs8wJaMfK3U', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:metadataScrubber');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Qi7Cy2rO5uFt9xKbNgL4V', 'role_WojF9F7kksBEftsmZGNhb', 'tools:metadataScrubber');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_time1TrackOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:track');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_time2ViewFirmOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:viewFirm');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_time3ApproveOwnerAdmn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:approve');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_time4RatesOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageRates');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_time5UtbmsOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageUtbms');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_time6SettingsOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageSettings');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Fh7Kp2qRnLtVc3xWbE4dJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileIntegrity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Rj8Dz4sQwHv1nPeKgF5mY', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileIntegrity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Sk9Ea5tRxJw2oPfLhG6nZ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileIntegrity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Tm0Fb6uSyKx3pQgMiH7aA', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileIntegrity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Un1Gc7vTzLy4qRhNjI8bB', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileIntegrity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_releaseChanAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageReleaseChannel');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_costs1TrackOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'costs:track');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_costs2TrackAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'costs:track');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_costs3TrackParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'costs:track');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_costs4ApproveOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'costs:approve');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_costs5ApproveBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'costs:approve');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_manageScanPolicyOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageScanPolicy');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:request');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'support:request');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'support:request');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'support:request');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supRequestReadonly000', 'role_WojF9F7kksBEftsmZGNhb', 'support:request');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supCosignOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:cosign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_supManageOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_K9H6U6-h6p6K_CLHI4KSJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileTypeVerifier');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_l8i1LDOqTksYZlUevdSmz', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileTypeVerifier');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_TpM9gHOSKQj54cXly1HdZ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileTypeVerifier');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_V8qn58SYu8l45K4WJKkNN', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileTypeVerifier');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_0VDhggjspFyXGAlClnLIz', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileTypeVerifier');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_n9yTH1WrSRVXLLqaJgWAz', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:aiTextDetection');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_uUiq-zdWUgv35Iyv8XNog', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:aiTextDetection');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_PThnEqwA0vW_Aeez42Wk1', 'role_917LCQyRKP50Z9bW89vXl', 'tools:aiTextDetection');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mNj8beGjMi0PFysLZ_9b7', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:aiTextDetection');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_YoruyyMsSKpYokuqR7H0Q', 'role_WojF9F7kksBEftsmZGNhb', 'tools:aiTextDetection');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Bp4Mn7qKsLv2wXdYeC8gH', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:decryption');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Cq5No8rLtMw3xYeZfD9hI', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:decryption');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Dr6Op9sMuNx4yZfAgE0iJ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:decryption');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Es7Pq0tNvOy5zAgBhF1jK', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:decryption');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ft8Qr1uOwPz6aBhCiG2kL', 'role_WojF9F7kksBEftsmZGNhb', 'tools:decryption');
