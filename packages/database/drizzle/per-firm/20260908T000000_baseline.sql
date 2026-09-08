-- THE PER-FIRM LINEAGE, COLLAPSED.
--
-- Every migration through 20260908T000000_baseline folded into the schema they produced. This file is
-- DUMPED from a database built by applying that chain, never written by hand, so it cannot
-- express anything the chain did not — and the collapse script's verify pass applies both and
-- compares every object and every seeded row.
--
-- Databases provisioned before the collapse carry the retired tags in their applied ledger; the
-- runner reconciles those through LEGACY_BASELINES in packages/database/src/legacy-baselines.ts,
-- not through anything here.
--
-- Regenerate: node packages/database/scripts/collapse-baseline.mjs per-firm --tag <tag>
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
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`actor_user_id` text,
	`subject_id` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
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
	`deleted_at` text, `recipient` text, `organization_name` text, `street_two` text, `dependent_locality` text, `sorting_code` text, `address_use` text, `address_type` text, `normalized_key` text, `contact_permitted` integer DEFAULT 1 NOT NULL CONSTRAINT `directory_address_contact_permitted_check` CHECK (`contact_permitted` IN (0, 1)), `contact_preferred` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_address_contact_preferred_check` CHECK (`contact_preferred` IN (0, 1)), `contact_note` text, `verification_status` text DEFAULT 'unverified' NOT NULL, `verified_at` text, `verified_by` text, `verification_detail` text,
	CONSTRAINT "directory_address_is_primary_check" CHECK("directory_address"."is_primary" IN (0, 1))
);
--> statement-breakpoint
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
	`deleted_at` text, `normalized_address` text, `contact_use` text, `contact_permitted` integer DEFAULT 1 NOT NULL CONSTRAINT `directory_email_contact_permitted_check` CHECK (`contact_permitted` IN (0, 1)), `contact_preferred` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_email_contact_preferred_check` CHECK (`contact_preferred` IN (0, 1)), `contact_note` text, `verification_status` text DEFAULT 'unverified' NOT NULL, `verified_at` text, `verified_by` text, `verification_detail` text,
	CONSTRAINT "directory_email_address_nonempty_check" CHECK(length("directory_email"."address") > 0),
	CONSTRAINT "directory_email_is_primary_check" CHECK("directory_email"."is_primary" IN (0, 1))
);
--> statement-breakpoint
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
	`deleted_at` text, `label` text,
	CONSTRAINT "directory_identifier_identifier_type_nonempty_check" CHECK(length("directory_identifier"."identifier_type") > 0)
);
--> statement-breakpoint
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
	`deleted_at` text, `normalized_match_key` text, `normalized_match_key_bare` text,
	CONSTRAINT "directory_name_entity_kind_check" CHECK("directory_name"."entity_kind" IN ('person', 'organization')),
	CONSTRAINT "directory_name_name_role_check" CHECK(length("directory_name"."name_role") > 0),
	CONSTRAINT "directory_name_is_current_check" CHECK("directory_name"."is_current" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `directory_name_phonetic_code` (
	`name_id` text NOT NULL,
	`scheme` text NOT NULL,
	`code` text NOT NULL,
	PRIMARY KEY(`name_id`, `scheme`),
	FOREIGN KEY (`name_id`) REFERENCES `directory_name`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "directory_name_phonetic_code_scheme_check" CHECK(length("directory_name_phonetic_code"."scheme") > 0)
);
--> statement-breakpoint
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
	`deleted_at` text, `pronoun_subject` text, `pronoun_object` text, `pronoun_possessive_determiner` text, `pronoun_possessive_pronoun` text, `pronoun_reflexive` text, `pronoun_verb_number` text CONSTRAINT `directory_person_pronoun_check` CHECK (
  (`pronoun_verb_number` IS NULL OR `pronoun_verb_number` IN ('singular', 'plural'))
  AND (`pronoun_object` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_possessive_determiner` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_possessive_pronoun` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_reflexive` IS NULL) = (`pronoun_subject` IS NULL)
  AND (`pronoun_verb_number` IS NULL) = (`pronoun_subject` IS NULL)
), `date_of_birth` text, `date_of_death` text, `deceased` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_person_deceased_check` CHECK (`deceased` IN (0, 1)),
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
	`deleted_at` text, `contact_system` text, `contact_use` text, `country_calling_code` text, `national_number` text, `extension` text, `country_region_code` text, `contact_permitted` integer DEFAULT 1 NOT NULL CONSTRAINT `directory_phone_contact_permitted_check` CHECK (`contact_permitted` IN (0, 1)), `contact_preferred` integer DEFAULT 0 NOT NULL CONSTRAINT `directory_phone_contact_preferred_check` CHECK (`contact_preferred` IN (0, 1)), `contact_note` text, `verification_status` text DEFAULT 'unverified' NOT NULL, `verified_at` text, `verified_by` text, `verification_detail` text,
	CONSTRAINT "directory_phone_number_nonempty_check" CHECK(length("directory_phone"."number") > 0),
	CONSTRAINT "directory_phone_is_primary_check" CHECK("directory_phone"."is_primary" IN (0, 1))
);
--> statement-breakpoint
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
	`committed_at` text, `source_modified_at` text,
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
CREATE TABLE `firm_secret` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
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
	`updated_at` text NOT NULL, `letterhead_logo_object_key` text, `letterhead_logo_content_type` text, `letterhead_logo_size_bytes` integer, `letterhead_logo_sha256` text, `letterhead_logo_width_pixels` integer, `letterhead_logo_height_pixels` integer, `letterhead_logo_width_emu` integer, `letterhead_logo_updated_at` text, `time_zone` text,
	CONSTRAINT "location_status_check" CHECK("location"."status" IN ('active', 'closed')),
	CONSTRAINT "location_name_nonempty_check" CHECK(length("location"."name") > 0)
);
--> statement-breakpoint
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
	`deleted_at` text, `capacity` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_party_role_nonempty_check" CHECK(length("matter_party"."role") > 0)
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
CREATE TABLE `member_role` (
	`id` text PRIMARY KEY NOT NULL,
	`member_user_id` text NOT NULL,
	`role_id` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
, `purpose` text DEFAULT 'matter' NOT NULL);
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
CREATE TABLE `picklist_option` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `role_permission` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
	`updated_at` text NOT NULL, `purchase_claim_key` text,
	FOREIGN KEY (`matter_ref`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
	`created_by` text, `memo` text, `entry_number` text, `task_id` text REFERENCES matter_task(id),
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
CREATE VIRTUAL TABLE `directory_name_fts` USING fts5(normalized_display, content='directory_name', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TABLE `file_repair_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`file_version_id` text NOT NULL,
	`operation` text NOT NULL,
	`fully_recovered` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`source_media_type` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conflicts_check` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`subject_matter_id` text,
	`subject_parties_json` text NOT NULL,
	`scope_json` text NOT NULL,
	`strictness` text NOT NULL,
	`depth` integer NOT NULL,
	`inputs_json` text NOT NULL,
	`floor_raised` integer DEFAULT 0 NOT NULL,
	`actor_user_id` text,
	`created_at` text NOT NULL, `trigger_source` text, `cause_json` text,
	CONSTRAINT `conflicts_check_trigger_check` CHECK (length(`trigger`) > 0),
	CONSTRAINT `conflicts_check_strictness_check` CHECK (`strictness` IN ('balanced', 'over_inclusive')),
	CONSTRAINT `conflicts_check_depth_check` CHECK (`depth` >= 0)
);
--> statement-breakpoint
CREATE TABLE `conflicts_hit` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`source_class` text NOT NULL,
	`evidence_tier` integer NOT NULL,
	`matched_fields_json` text NOT NULL,
	`graph_path_json` text NOT NULL,
	`created_at` text NOT NULL, `co_party` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `conflicts_check`(`id`),
	CONSTRAINT `conflicts_hit_tier_check` CHECK (`evidence_tier` BETWEEN 1 AND 4),
	CONSTRAINT `conflicts_hit_source_class_check` CHECK (`source_class` IN ('party', 'graph', 'imputation', 'content'))
);
--> statement-breakpoint
CREATE TABLE `conflicts_disposition` (
	`id` text PRIMARY KEY NOT NULL,
	`hit_id` text NOT NULL,
	`kind` text NOT NULL,
	`rationale` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`created_at` text NOT NULL, `waiver_given_by_entity_id` text, `waiver_confirmed_in_writing` integer CONSTRAINT `conflicts_disposition_waiver_confirmed_in_writing_check` CHECK (`waiver_confirmed_in_writing` IS NULL OR `waiver_confirmed_in_writing` IN (0, 1)), `waiver_document_file_id` text REFERENCES `file`(`id`), `waiver_given_on` text CONSTRAINT `conflicts_disposition_waiver_given_on_shape_check` CHECK (`waiver_given_on` IS NULL OR `waiver_given_on` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	FOREIGN KEY (`hit_id`) REFERENCES `conflicts_hit`(`id`),
	CONSTRAINT `conflicts_disposition_kind_check` CHECK (`kind` IN ('cleared', 'waiver_obtained', 'wall_erected', 'representation_declined'))
);
--> statement-breakpoint
CREATE TABLE `email_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_normalized` text,
	`first_seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id_value` text,
	`message_id_provenance` text NOT NULL,
	`subject` text,
	`sent_at` text,
	`received_at` text NOT NULL,
	`from_display` text,
	`from_address` text,
	`thread_id` text NOT NULL,
	`in_reply_to` text,
	`content_sha256` text NOT NULL,
	`dedup_key` text NOT NULL,
	`original_r2_key` text NOT NULL,
	`references_remote_content` integer DEFAULT 0 NOT NULL,
	`integrity` text NOT NULL,
	`dkim_verdict` text DEFAULT 'unverified' NOT NULL,
	`source_format` text NOT NULL,
	`captured_via` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `dkim_verdict_reason` text, `dkim_verified_domain` text,
	FOREIGN KEY (`thread_id`) REFERENCES `email_thread`(`id`),
	CONSTRAINT `email_message_provenance_check` CHECK (`message_id_provenance` IN ('header', 'mapi', 'absent')),
	CONSTRAINT `email_message_dkim_verdict_check` CHECK (`dkim_verdict` IN ('unverified', 'pass', 'fail')),
	CONSTRAINT `email_message_source_format_check` CHECK (`source_format` IN ('eml', 'msg', 'mboxMember')),
	CONSTRAINT `email_message_captured_via_check` CHECK (`captured_via` IN ('forward', 'api', 'addin', 'sync'))
);
--> statement-breakpoint
CREATE TABLE `email_matter_link` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`state` text DEFAULT 'staged' NOT NULL,
	`linked_by` text,
	`linked_at` text,
	`captured_via` text NOT NULL,
	`tags` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `auto_file_rule_id` text REFERENCES email_auto_file_rule(id),
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `email_matter_link_state_check` CHECK (`state` IN ('staged', 'filed', 'unlinked')),
	CONSTRAINT `email_matter_link_captured_via_check` CHECK (`captured_via` IN ('forward', 'api', 'addin', 'sync'))
);
--> statement-breakpoint
CREATE TABLE `email_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text,
	`address` text,
	`directory_entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`),
	CONSTRAINT `email_participant_kind_check` CHECK (`kind` IN ('from', 'to', 'cc', 'bcc'))
);
--> statement-breakpoint
CREATE TABLE `email_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`file_id` text,
	`filename` text,
	`media_type` text,
	`disposition` text NOT NULL,
	`promoted_from_inline` integer DEFAULT 0 NOT NULL,
	`outcome` text DEFAULT 'extracted' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`),
	CONSTRAINT `email_attachment_disposition_check` CHECK (`disposition` IN ('attachment', 'inline')),
	CONSTRAINT `email_attachment_outcome_check` CHECK (`outcome` IN ('extracted', 'filtered_inline', 'oversize'))
);
--> statement-breakpoint
CREATE TABLE `email_capture_address` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`matter_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`rotated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `email_capture_address_kind_check` CHECK (`kind` IN ('matter', 'catchAll'))
);
--> statement-breakpoint
CREATE TABLE `index_split` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`object_key` text NOT NULL,
	`document_count` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`schema_generation` integer NOT NULL,
	`created_at` text NOT NULL,
	`superseded_at` text
, `document_id` text, `version` integer, `corpus_kind` text DEFAULT 'matter' NOT NULL, `corpus_id` text);
--> statement-breakpoint
CREATE TABLE `matter_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`matter_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `document_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`matter_type_id` text,
	`location_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_version_id` text,
	`created_by` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`),
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`),
	CONSTRAINT `document_template_name_nonempty_check` CHECK (length(`name`) > 0),
	CONSTRAINT `document_template_status_check` CHECK (`status` IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE `document_template_version` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer,
	`content_sha256` text,
	`storage_encoding` text DEFAULT 'full' NOT NULL,
	`storage_class` text DEFAULT 'standard' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scan_verdict` text,
	`scan_engine_version` text,
	`scan_detail` text,
	`field_manifest_json` text DEFAULT '{}' NOT NULL,
	`normalization_warnings_json` text DEFAULT '[]' NOT NULL,
	`normalizer_version` integer DEFAULT 0 NOT NULL,
	`macro_parts_removed` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`committed_at` text, `kind` text DEFAULT 'wordProcessing' NOT NULL CONSTRAINT `document_template_version_kind_check` CHECK (`kind` IN ('wordProcessing', 'pdfForm')),
	FOREIGN KEY (`template_id`) REFERENCES `document_template`(`id`),
	CONSTRAINT `document_template_version_status_check` CHECK (`status` IN ('pending', 'clean', 'quarantined', 'abandoned')),
	CONSTRAINT `document_template_version_storage_class_check` CHECK (`storage_class` IN ('standard', 'infrequent_access')),
	CONSTRAINT `document_template_version_scan_verdict_check` CHECK (`scan_verdict` IS NULL OR `scan_verdict` IN ('unscanned', 'clean', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE `document_assembly` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`folder_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`outcome` text,
	`failure_reason` text,
	`file_id` text,
	`file_version_id` text,
	`engine_version` integer DEFAULT 0 NOT NULL,
	`dictionary_version` integer DEFAULT 0 NOT NULL,
	`absent_field_count` integer DEFAULT 0 NOT NULL,
	`absent_field_keys_json` text DEFAULT '[]' NOT NULL,
	`requested_by` text,
	`created_at` text NOT NULL,
	`completed_at` text, `frozen_field_count` integer DEFAULT 0 NOT NULL, `frozen_field_names_json` text DEFAULT '[]' NOT NULL, `output_format` text DEFAULT 'docx' NOT NULL CONSTRAINT `document_assembly_output_format_check` CHECK (`output_format` IN ('docx', 'pdf')),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`template_id`) REFERENCES `document_template`(`id`),
	FOREIGN KEY (`template_version_id`) REFERENCES `document_template_version`(`id`),
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`),
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`),
	CONSTRAINT `document_assembly_status_check` CHECK (`status` IN ('queued', 'running', 'done', 'failed')),
	CONSTRAINT `document_assembly_outcome_check` CHECK (`outcome` IS NULL OR `outcome` IN ('succeeded', 'succeeded_with_absences', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `custody_location` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_location_id` text,
	`firm_location_id` text,
	`address` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`firm_location_id`) REFERENCES `location`(`id`),
	CONSTRAINT `custody_location_name_check` CHECK (length(`name`) > 0),
	CONSTRAINT `custody_location_kind_check` CHECK (`kind` IN ('office', 'room', 'safe', 'cabinet', 'shelf', 'box', 'position', 'offsite', 'bank')),
	CONSTRAINT `custody_location_status_check` CHECK (`status` IN ('active', 'closed')),
	CONSTRAINT `custody_location_firm_binding_check` CHECK (`firm_location_id` IS NULL OR `parent_location_id` IS NULL)
);
--> statement-breakpoint
CREATE TABLE `custody_item_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`intrinsic_value_default` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `custody_item_type_name_check` CHECK (length(`name`) > 0)
);
--> statement-breakpoint
CREATE TABLE `custody_packet` (
	`id` text PRIMARY KEY NOT NULL,
	`custody_number` text NOT NULL,
	`number_source` text NOT NULL,
	`name` text NOT NULL,
	`current_location_id` text,
	`status` text DEFAULT 'held' NOT NULL,
	`matter_id` text,
	`depositor_entity_id` text,
	`deposited_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `review_on` text, `review_interval_months` integer CONSTRAINT `custody_packet_review_interval_check` CHECK (`review_interval_months` IS NULL OR (`review_interval_months` > 0 AND `review_interval_months` <= 600)),
	FOREIGN KEY (`current_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `custody_packet_name_check` CHECK (length(`name`) > 0),
	CONSTRAINT `custody_packet_number_check` CHECK (length(`custody_number`) > 0),
	CONSTRAINT `custody_packet_number_source_check` CHECK (`number_source` IN ('drawn', 'manual')),
	CONSTRAINT `custody_packet_status_check` CHECK (`status` IN ('held', 'out', 'released', 'destroyed', 'lost'))
);
--> statement-breakpoint
CREATE TABLE `custody_item` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`item_type_id` text,
	`description` text NOT NULL,
	`instrument_date` text,
	`intrinsic_value` integer DEFAULT 0 NOT NULL,
	`declared_value_amount_minor` integer,
	`declared_value_currency` text,
	`status` text DEFAULT 'held' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `review_on` text, `review_interval_months` integer CONSTRAINT `custody_item_review_interval_check` CHECK (`review_interval_months` IS NULL OR (`review_interval_months` > 0 AND `review_interval_months` <= 600)),
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_type_id`) REFERENCES `custody_item_type`(`id`),
	CONSTRAINT `custody_item_description_check` CHECK (length(`description`) > 0),
	CONSTRAINT `custody_item_ordinal_check` CHECK (`ordinal` > 0),
	CONSTRAINT `custody_item_status_check` CHECK (`status` IN ('held', 'out', 'released', 'destroyed', 'lost', 'superseded')),
	CONSTRAINT `custody_item_declared_value_check` CHECK ((`declared_value_amount_minor` IS NULL) = (`declared_value_currency` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `custody_owner` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`ownership_role` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`)
);
--> statement-breakpoint
CREATE TABLE `custody_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`kind` text NOT NULL,
	`placed_at` text NOT NULL,
	`placed_by` text,
	`reason` text,
	`released_at` text,
	`released_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	CONSTRAINT `custody_hold_kind_check` CHECK (`kind` IN ('legal', 'discovery', 'client_instruction', 'dispute', 'unclaimed'))
);
--> statement-breakpoint
CREATE TABLE `custody_scan` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`captured_at` text NOT NULL,
	`captured_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`),
	CONSTRAINT `custody_scan_kind_check` CHECK (`kind` IN ('scan', 'photograph', 'receipt', 'appraisal', 'correspondence'))
);
--> statement-breakpoint
CREATE TABLE `custody_destruction_request` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`requested_by` text,
	`requested_at` text NOT NULL,
	`basis` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`executed_at` text,
	`outcome` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `refused_by` text, `refused_at` text, `refusal_reason` text, `executed_by` text, `executed_movement_id` text,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	CONSTRAINT `custody_destruction_request_basis_check` CHECK (length(`basis`) > 0),
	CONSTRAINT `custody_destruction_request_approver_check` CHECK (`approved_by` IS NULL OR `requested_by` IS NULL OR `approved_by` <> `requested_by`),
	CONSTRAINT `custody_destruction_request_outcome_check` CHECK (`outcome` IS NULL OR `outcome` IN ('approved', 'refused', 'executed', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE `custody_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custody_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`packet_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_template_field_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`field_name` text NOT NULL,
	`merge_key` text NOT NULL,
	`times_applied` integer DEFAULT 0 NOT NULL,
	`confirmed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `document_template_field_mapping_field_name_nonempty_check` CHECK (length(`field_name`) > 0),
	CONSTRAINT `document_template_field_mapping_merge_key_nonempty_check` CHECK (length(`merge_key`) > 0)
);
--> statement-breakpoint
CREATE TABLE "custody_movement" (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`item_id` text,
	`kind` text NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by_user_id` text,
	`from_location_id` text,
	`to_location_id` text,
	`borrower_kind` text,
	`borrower_user_id` text,
	`borrower_entity_id` text,
	`borrower_name` text,
	`due_back_on` text,
	`reason` text,
	`corrects_movement_id` text,
	`shipment_id` text,
	`note` text, `release_authority_basis` text, `release_identity_evidence` text, `release_identity_verified_by_user_id` text, `release_witnessed_by_user_id` text,
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	FOREIGN KEY (`from_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`to_location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`shipment_id`) REFERENCES `shipment`(`id`),
	CONSTRAINT `custody_movement_kind_check` CHECK (`kind` IN ('logged', 'itemized', 'moved', 'checked_out', 'returned', 'withdrawn', 'released', 'superseded', 'destroyed', 'lost', 'found', 'reviewed', 'hold_placed', 'hold_released', 'correction')),
	CONSTRAINT `custody_movement_borrower_kind_check` CHECK (`borrower_kind` IS NULL OR `borrower_kind` IN ('member', 'entity', 'external')),
	CONSTRAINT `custody_movement_borrower_shape_check` CHECK ((`borrower_kind` IS NULL) OR (`borrower_kind` = 'member' AND `borrower_user_id` IS NOT NULL) OR (`borrower_kind` = 'entity' AND `borrower_entity_id` IS NOT NULL) OR (`borrower_kind` = 'external' AND `borrower_name` IS NOT NULL)),
	CONSTRAINT `custody_movement_correction_check` CHECK (`corrects_movement_id` IS NULL OR `kind` = 'correction')
);
--> statement-breakpoint
CREATE TABLE `trust_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location_id` text NOT NULL,
	`jurisdiction` text,
	`bank_name` text,
	`account_number_last_four` text,
	`currency` text NOT NULL,
	`iolta` integer DEFAULT 1 NOT NULL,
	`bank_ledger_account_id` text NOT NULL,
	`client_liability_account_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_on` text NOT NULL,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`),
	FOREIGN KEY (`bank_ledger_account_id`) REFERENCES `ledger_account`(`id`),
	FOREIGN KEY (`client_liability_account_id`) REFERENCES `ledger_account`(`id`),
	CONSTRAINT `trust_account_name_nonempty_check` CHECK (length(`name`) > 0),
	CONSTRAINT `trust_account_status_check` CHECK (`status` IN ('open', 'closed')),
	CONSTRAINT `trust_account_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_account_distinct_sides_check` CHECK (`bank_ledger_account_id` <> `client_liability_account_id`),
	CONSTRAINT `trust_account_last_four_check` CHECK (`account_number_last_four` IS NULL OR `account_number_last_four` GLOB '[0-9][0-9][0-9][0-9]'),
	CONSTRAINT `trust_account_closed_at_check` CHECK ((`status` = 'closed') = (`closed_at` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `trust_ledger_node` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`ledger_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`client_entity_id` text,
	`matter_id` text,
	`parent_node_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`parent_node_id`) REFERENCES `trust_ledger_node`(`id`),
	CONSTRAINT `trust_ledger_node_kind_check` CHECK (`kind` IN ('client', 'matter', 'firm_funds')),
	CONSTRAINT `trust_ledger_node_shape_check` CHECK ((`kind` = 'client' AND `client_entity_id` IS NOT NULL AND `matter_id` IS NULL AND `parent_node_id` IS NULL) OR (`kind` = 'matter' AND `client_entity_id` IS NOT NULL AND `matter_id` IS NOT NULL AND `parent_node_id` IS NOT NULL) OR (`kind` = 'firm_funds' AND `client_entity_id` IS NULL AND `matter_id` IS NULL AND `parent_node_id` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `trust_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`reason` text NOT NULL,
	`placed_at` text NOT NULL,
	`placed_by` text,
	`releases_hold_id` text,
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`releases_hold_id`) REFERENCES `trust_hold`(`id`),
	CONSTRAINT `trust_hold_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_hold_reason_nonempty_check` CHECK (length(`reason`) > 0),
	CONSTRAINT `trust_hold_currency_check` CHECK (length(`currency`) = 3)
);
--> statement-breakpoint
CREATE TABLE `trust_transfer` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`trust_entry_id` text NOT NULL,
	`operating_entry_id` text NOT NULL,
	`authorized_by` text,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL, `recorded_by` text, `policy_id` text REFERENCES `trust_authorization_policy`(`id`), `approved_request_id` text REFERENCES `trust_disbursement_request`(`id`),
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`from_node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`trust_entry_id`) REFERENCES `ledger_entry`(`id`),
	FOREIGN KEY (`operating_entry_id`) REFERENCES `ledger_entry`(`id`),
	CONSTRAINT `trust_transfer_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_transfer_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_transfer_distinct_entries_check` CHECK (`trust_entry_id` <> `operating_entry_id`)
);
--> statement-breakpoint
CREATE TABLE `trust_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`node_id` text NOT NULL,
	`counterparty_node_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`entry_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`counterparty_name` text,
	`purpose` text NOT NULL,
	`recorded_by` text NOT NULL,
	`authorized_by` text,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`counterparty_node_id`) REFERENCES `trust_ledger_node`(`id`),
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`),
	CONSTRAINT `trust_movement_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_movement_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_movement_purpose_nonempty_check` CHECK (length(`purpose`) > 0),
	CONSTRAINT `trust_movement_kind_check` CHECK (`kind` IN ('deposit', 'disbursement', 'matter_transfer')),
	CONSTRAINT `trust_movement_method_check` CHECK (`method` IN ('check', 'cash', 'wire', 'electronic_transfer', 'card', 'internal')),
	CONSTRAINT `trust_movement_shape_check` CHECK ((`kind` = 'deposit' AND `counterparty_node_id` IS NULL AND `method` <> 'internal' AND `counterparty_name` IS NOT NULL) OR (`kind` = 'disbursement' AND `counterparty_node_id` IS NULL AND `method` <> 'internal' AND `counterparty_name` IS NOT NULL AND `authorized_by` IS NOT NULL) OR (`kind` = 'matter_transfer' AND `counterparty_node_id` IS NOT NULL AND `counterparty_node_id` <> `node_id` AND `method` = 'internal' AND `counterparty_name` IS NULL AND `authorized_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `custody_stocktake` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_location_id` text,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by_user_id` text,
	`closed_at` text,
	`closed_by_user_id` text,
	`matched_count` integer,
	`missing_count` integer,
	`misplaced_count` integer,
	`unexpected_count` integer,
	`unregistered_count` integer,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scope_location_id`) REFERENCES `custody_location`(`id`),
	CONSTRAINT `custody_stocktake_name_check` CHECK (length(`name`) > 0),
	CONSTRAINT `custody_stocktake_status_check` CHECK (`status` IN ('open', 'closed', 'abandoned')),
	CONSTRAINT `custody_stocktake_closure_check` CHECK ((`status` = 'open' AND `closed_at` IS NULL) OR (`status` <> 'open' AND `closed_at` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `custody_stocktake_sighting` (
	`id` text PRIMARY KEY NOT NULL,
	`stocktake_id` text NOT NULL,
	`kind` text NOT NULL,
	`packet_id` text,
	`item_id` text,
	`location_id` text,
	`expected_location_id` text,
	`description` text,
	`observed_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`observed_by_user_id` text,
	`note` text,
	FOREIGN KEY (`stocktake_id`) REFERENCES `custody_stocktake`(`id`),
	FOREIGN KEY (`packet_id`) REFERENCES `custody_packet`(`id`),
	FOREIGN KEY (`item_id`) REFERENCES `custody_item`(`id`),
	FOREIGN KEY (`location_id`) REFERENCES `custody_location`(`id`),
	FOREIGN KEY (`expected_location_id`) REFERENCES `custody_location`(`id`),
	CONSTRAINT `custody_stocktake_sighting_kind_check` CHECK (`kind` IN ('sighted', 'not_found', 'unregistered')),
	CONSTRAINT `custody_stocktake_sighting_shape_check` CHECK ((`kind` = 'sighted' AND `packet_id` IS NOT NULL AND `location_id` IS NOT NULL) OR (`kind` = 'not_found' AND `packet_id` IS NOT NULL) OR (`kind` = 'unregistered' AND `packet_id` IS NULL AND `item_id` IS NULL AND `location_id` IS NOT NULL AND `description` IS NOT NULL AND length(`description`) > 0))
);
--> statement-breakpoint
CREATE TABLE `trust_disbursement_request` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`node_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`payee` text NOT NULL,
	`purpose` text NOT NULL,
	`description` text NOT NULL,
	`effective_date` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL, `kind` text NOT NULL DEFAULT 'disbursement', `operating_description` text, `policy_id` text REFERENCES `trust_authorization_policy`(`id`),
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`),
	CONSTRAINT `trust_disbursement_request_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_disbursement_request_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_disbursement_request_method_check` CHECK (`method` IN ('check', 'cash', 'wire', 'electronic_transfer', 'card')),
	CONSTRAINT `trust_disbursement_request_payee_nonempty_check` CHECK (length(`payee`) > 0),
	CONSTRAINT `trust_disbursement_request_purpose_nonempty_check` CHECK (length(`purpose`) > 0),
	CONSTRAINT `trust_disbursement_request_description_nonempty_check` CHECK (length(`description`) > 0)
);
--> statement-breakpoint
CREATE TABLE `trust_bank_statement` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`opening_balance_minor` integer NOT NULL,
	`closing_balance_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`statement_reference` text,
	`source` text NOT NULL,
	`supersedes_statement_id` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`supersedes_statement_id`) REFERENCES `trust_bank_statement`(`id`),
	CONSTRAINT `trust_bank_statement_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `trust_bank_statement_period_order_check` CHECK (`period_end` >= `period_start`),
	CONSTRAINT `trust_bank_statement_source_check` CHECK (`source` IN ('entered', 'imported'))
);
--> statement-breakpoint
CREATE TABLE `trust_bank_statement_line` (
	`id` text PRIMARY KEY NOT NULL,
	`statement_id` text NOT NULL,
	`posted_on` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`counterparty_name` text,
	`source_row_number` integer,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `trust_bank_statement`(`id`),
	CONSTRAINT `trust_bank_statement_line_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `trust_bank_statement_line_description_nonempty_check` CHECK (length(`description`) > 0),
	CONSTRAINT `trust_bank_statement_line_direction_check` CHECK (`direction` IN ('deposit', 'withdrawal')),
	CONSTRAINT `trust_bank_statement_line_source_row_check` CHECK (`source_row_number` IS NULL OR `source_row_number` > 0)
);
--> statement-breakpoint
CREATE TABLE `trust_reconciliation` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`status` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`frozen_statement_closing_minor` integer,
	`frozen_outstanding_deposits_minor` integer,
	`frozen_outstanding_disbursements_minor` integer,
	`frozen_adjusted_bank_minor` integer,
	`frozen_book_balance_minor` integer,
	`frozen_client_total_minor` integer,
	`frozen_unmatched_line_count` integer,
	`frozen_unmatched_movement_count` integer,
	`frozen_balanced` integer,
	`supersedes_reconciliation_id` text,
	`note` text, `frozen_firm_funds_minor` integer,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`),
	FOREIGN KEY (`statement_id`) REFERENCES `trust_bank_statement`(`id`),
	FOREIGN KEY (`supersedes_reconciliation_id`) REFERENCES `trust_reconciliation`(`id`),
	CONSTRAINT `trust_reconciliation_status_check` CHECK (`status` IN ('open', 'closed')),
	CONSTRAINT `trust_reconciliation_shape_check` CHECK ((`status` = 'open' AND `closed_by` IS NULL AND `closed_at` IS NULL AND `frozen_statement_closing_minor` IS NULL AND `frozen_outstanding_deposits_minor` IS NULL AND `frozen_outstanding_disbursements_minor` IS NULL AND `frozen_adjusted_bank_minor` IS NULL AND `frozen_book_balance_minor` IS NULL AND `frozen_client_total_minor` IS NULL AND `frozen_unmatched_line_count` IS NULL AND `frozen_unmatched_movement_count` IS NULL AND `frozen_balanced` IS NULL) OR (`status` = 'closed' AND `closed_by` IS NOT NULL AND `closed_at` IS NOT NULL AND `frozen_statement_closing_minor` IS NOT NULL AND `frozen_outstanding_deposits_minor` IS NOT NULL AND `frozen_outstanding_disbursements_minor` IS NOT NULL AND `frozen_adjusted_bank_minor` IS NOT NULL AND `frozen_book_balance_minor` IS NOT NULL AND `frozen_client_total_minor` IS NOT NULL AND `frozen_unmatched_line_count` IS NOT NULL AND `frozen_unmatched_movement_count` IS NOT NULL AND `frozen_balanced` IN (0, 1))),
	CONSTRAINT `trust_reconciliation_outstanding_sign_check` CHECK ((`frozen_outstanding_deposits_minor` IS NULL OR `frozen_outstanding_deposits_minor` >= 0) AND (`frozen_outstanding_disbursements_minor` IS NULL OR `frozen_outstanding_disbursements_minor` >= 0) AND (`frozen_unmatched_line_count` IS NULL OR `frozen_unmatched_line_count` >= 0) AND (`frozen_unmatched_movement_count` IS NULL OR `frozen_unmatched_movement_count` >= 0))
);
--> statement-breakpoint
CREATE TABLE `trust_reconciliation_match` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`statement_line_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`unmatches_match_id` text,
	`matched_by` text NOT NULL,
	`matched_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_reconciliation`(`id`),
	FOREIGN KEY (`statement_line_id`) REFERENCES `trust_bank_statement_line`(`id`),
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`),
	FOREIGN KEY (`unmatches_match_id`) REFERENCES `trust_reconciliation_match`(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_auto_file_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`matter_id` text NOT NULL,
	`match_value` text NOT NULL,
	`promotion` text DEFAULT 'stage' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`suspended_reason` text,
	`created_by` text,
	`created_from_email_message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_from_email_message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_auto_file_rule_kind_check" CHECK("email_auto_file_rule"."kind" IN ('threadContinuation', 'correspondentMatter')),
	CONSTRAINT "email_auto_file_rule_promotion_check" CHECK("email_auto_file_rule"."promotion" IN ('stage', 'file')),
	CONSTRAINT "email_auto_file_rule_state_check" CHECK("email_auto_file_rule"."state" IN ('active', 'suspended', 'revoked')),
	CONSTRAINT "email_auto_file_rule_suspended_reason_check" CHECK("email_auto_file_rule"."suspended_reason" IS NULL OR "email_auto_file_rule"."suspended_reason" IN ('creatorAccessWithdrawn', 'matterClosed', 'blastBound', 'undoRate', 'member')),
	CONSTRAINT "email_auto_file_rule_suspended_reason_state_check" CHECK(("email_auto_file_rule"."state" = 'suspended') = ("email_auto_file_rule"."suspended_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `email_auto_file_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`auto_file_rule_id` text,
	`matter_id` text,
	`outcome` text NOT NULL,
	`suppression_reason` text,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auto_file_rule_id`) REFERENCES `email_auto_file_rule`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_auto_file_decision_outcome_check" CHECK("email_auto_file_decision"."outcome" IN ('filed', 'staged', 'suppressed')),
	CONSTRAINT "email_auto_file_decision_suppression_reason_check" CHECK("email_auto_file_decision"."suppression_reason" IS NULL OR "email_auto_file_decision"."suppression_reason" IN ('ambiguousEvidence', 'creatorAccessWithdrawn', 'senderNotAuthenticated', 'signatureFailed', 'humanFilingDecision', 'matterNotOpen', 'ruleNotActive', 'incompleteEvidence')),
	CONSTRAINT "email_auto_file_decision_suppression_reason_outcome_check" CHECK(("email_auto_file_decision"."outcome" = 'suppressed') = ("email_auto_file_decision"."suppression_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`client_entity_id` text NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`invoice_number` text,
	`number_scope_key` text,
	`number_drawn_value` integer,
	`billing_period_start` text,
	`billing_period_end` text,
	`issue_date` text,
	`due_date` text,
	`notes` text,
	`location_id` text,
	`letterhead_address_block` text,
	`letterhead_footer` text,
	`remit_to` text,
	`client_billing_name` text,
	`finalized_at` text,
	`finalized_by` text,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text, `render_shape` text CHECK (`render_shape` IS NULL OR `render_shape` IN ('combined', 'per_matter_pages')),
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`),
	CONSTRAINT `invoice_status_check` CHECK (`status` IN ('draft', 'final', 'void')),
	CONSTRAINT `invoice_currency_check` CHECK (length(`currency`) = 3),
	-- A number exists exactly when the invoice is final: it is drawn INSIDE the finalize batch, so a
	-- failed finalize consumes none and the sequence has no gaps by construction.
	CONSTRAINT `invoice_number_paired_check` CHECK ((`status` = 'final') = (`invoice_number` IS NOT NULL)),
	CONSTRAINT `invoice_number_draw_paired_check` CHECK ((`invoice_number` IS NULL) = (`number_drawn_value` IS NULL) AND (`invoice_number` IS NULL) = (`number_scope_key` IS NULL)),
	CONSTRAINT `invoice_finalized_paired_check` CHECK ((`status` = 'final') = (`finalized_at` IS NOT NULL)),
	CONSTRAINT `invoice_voided_paired_check` CHECK ((`status` = 'void') = (`voided_at` IS NOT NULL)),
	-- A bill the firm has issued states when it was issued and when it is due. Both are null while
	-- the invoice is a working document and required the moment it becomes evidence.
	CONSTRAINT `invoice_dates_final_check` CHECK (`status` <> 'final' OR (`issue_date` IS NOT NULL AND `due_date` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`quantity_e4` integer,
	`rate_e4` integer,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`utbms_task_code` text,
	`utbms_activity_code` text,
	`utbms_expense_code` text,
	`tax_treatment` text DEFAULT 'exempt' NOT NULL,
	`created_at` text NOT NULL, `billing_arrangement_id` text REFERENCES `matter_billing_arrangement`(`id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `invoice_line_kind_check` CHECK (`kind` IN ('fee', 'cost', 'flat_fee', 'discount', 'adjustment', 'interest', 'tax')),
	-- Deliberately NOT a positive-amount check: a discount, a write-down, or a courtesy adjustment is
	-- an ordinary line with a negative amount, which is why roundInvoiceLine is half-away-from-zero.
	-- The ledger's positive-amounts rule governs ledger_line and is untouched by this.
	CONSTRAINT `invoice_line_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `invoice_line_description_nonempty_check` CHECK (length(`description`) > 0),
	CONSTRAINT `invoice_line_tax_treatment_check` CHECK (`tax_treatment` IN ('taxable', 'exempt')),
	CONSTRAINT `invoice_line_index_check` CHECK (`line_index` >= 0)
);
--> statement-breakpoint
CREATE TABLE `invoice_wip_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`invoice_line_id` text,
	`claimed_amount_minor` integer NOT NULL,
	`claimed_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`invoice_line_id`) REFERENCES `invoice_line`(`id`),
	CONSTRAINT `invoice_wip_claim_source_kind_check` CHECK (`source_kind` IN ('time_entry', 'cost_entry'))
);
--> statement-breakpoint
CREATE TABLE `invoice_matter_balance` (
	`invoice_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`total_minor` integer NOT NULL,
	`applied_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`invoice_id`, `matter_id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `invoice_matter_balance_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `invoice_matter_balance_bounds_check` CHECK (`applied_minor` >= 0 AND `applied_minor` <= `total_minor`)
);
--> statement-breakpoint
CREATE TABLE `invoice_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL,
	CONSTRAINT `invoice_number_counter_next_value_check` CHECK (`next_value` > 0)
);
--> statement-breakpoint
CREATE TABLE `invoice_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`invoice_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY (`scope_key`, `drawn_value`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	CONSTRAINT `invoice_number_allocation_drawn_value_check` CHECK (`drawn_value` > 0)
);
--> statement-breakpoint
CREATE TABLE `firm_account_role` (
	`role` text PRIMARY KEY NOT NULL,
	`ledger_account_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_account`(`id`),
	CONSTRAINT `firm_account_role_role_check` CHECK (`role` IN ('accounts_receivable', 'fee_income', 'client_costs_advanced', 'cost_recovery_income', 'tax_payable', 'fee_adjustments', 'fee_write_off', 'operating_bank', 'client_credit_liability'))
);
--> statement-breakpoint
CREATE TABLE `matter_event_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`category` text DEFAULT 'litigation' NOT NULL,
	`origin` text DEFAULT 'firm' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_event_type_name_check" CHECK(length("matter_event_type"."name") > 0),
	CONSTRAINT "matter_event_type_category_check" CHECK("matter_event_type"."category" IN ('litigation', 'transaction', 'firm', 'other')),
	CONSTRAINT "matter_event_type_origin_check" CHECK("matter_event_type"."origin" IN ('platform', 'firm'))
);
--> statement-breakpoint
CREATE TABLE `matter_event` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`event_type_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_on` text NOT NULL,
	`starts_at_time` text,
	`ends_on` text,
	`ends_at_time` text,
	`time_zone` text NOT NULL,
	`location_text` text,
	`court_reference` text,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `status_reason` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_type_id`) REFERENCES `matter_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_event_title_check" CHECK(length("matter_event"."title") > 0),
	CONSTRAINT "matter_event_status_check" CHECK("matter_event"."status" IN ('scheduled', 'occurred', 'cancelled')),
	CONSTRAINT "matter_event_time_zone_check" CHECK(length("matter_event"."time_zone") > 0),
	CONSTRAINT "matter_event_starts_on_shape_check" CHECK("matter_event"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_event_ends_on_shape_check" CHECK("matter_event"."ends_on" IS NULL OR "matter_event"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_event_starts_at_time_shape_check" CHECK("matter_event"."starts_at_time" IS NULL OR "matter_event"."starts_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_event_ends_at_time_shape_check" CHECK("matter_event"."ends_at_time" IS NULL OR "matter_event"."ends_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_event_range_check" CHECK("matter_event"."ends_on" IS NULL OR "matter_event"."ends_on" >= "matter_event"."starts_on"),
	CONSTRAINT "matter_event_end_time_check" CHECK("matter_event"."ends_at_time" IS NULL OR "matter_event"."starts_at_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `matter_event_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`member_user_id` text,
	`entity_id` text,
	`participant_name` text,
	`role` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_event_participant_kind_check" CHECK("matter_event_participant"."participant_kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "matter_event_participant_shape_check" CHECK(("matter_event_participant"."participant_kind" = 'member' AND "matter_event_participant"."member_user_id" IS NOT NULL)
        OR ("matter_event_participant"."participant_kind" = 'entity' AND "matter_event_participant"."entity_id" IS NOT NULL)
        OR ("matter_event_participant"."participant_kind" = 'external' AND "matter_event_participant"."participant_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `matter_deadline` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`due_on` text NOT NULL,
	`due_at_time` text,
	`time_zone` text NOT NULL,
	`source` text DEFAULT 'member' NOT NULL,
	`catalog_entry_key` text,
	`catalog_version` text,
	`authority_text` text,
	`trigger_event_id` text,
	`state` text DEFAULT 'open' NOT NULL,
	`satisfied_at` text,
	`satisfied_by` text,
	`satisfying_event_id` text,
	`satisfaction_note` text,
	`state_reason` text,
	`superseded_by_deadline_id` text,
	`priority` integer,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`satisfying_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_deadline_title_check" CHECK(length("matter_deadline"."title") > 0),
	CONSTRAINT "matter_deadline_time_zone_check" CHECK(length("matter_deadline"."time_zone") > 0),
	CONSTRAINT "matter_deadline_due_on_shape_check" CHECK("matter_deadline"."due_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_deadline_due_at_time_shape_check" CHECK("matter_deadline"."due_at_time" IS NULL OR "matter_deadline"."due_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_deadline_source_check" CHECK("matter_deadline"."source" IN ('member', 'court_order', 'statutory_catalog')),
	CONSTRAINT "matter_deadline_catalog_shape_check" CHECK(("matter_deadline"."source" = 'statutory_catalog' AND "matter_deadline"."catalog_entry_key" IS NOT NULL AND "matter_deadline"."catalog_version" IS NOT NULL)
        OR ("matter_deadline"."source" <> 'statutory_catalog' AND "matter_deadline"."catalog_entry_key" IS NULL AND "matter_deadline"."catalog_version" IS NULL)),
	CONSTRAINT "matter_deadline_state_check" CHECK("matter_deadline"."state" IN ('open', 'satisfied', 'vacated', 'superseded')),
	CONSTRAINT "matter_deadline_state_reason_check" CHECK("matter_deadline"."state" NOT IN ('vacated', 'superseded') OR ("matter_deadline"."state_reason" IS NOT NULL AND length("matter_deadline"."state_reason") > 0)),
	CONSTRAINT "matter_deadline_satisfaction_shape_check" CHECK(("matter_deadline"."state" = 'satisfied' AND "matter_deadline"."satisfied_at" IS NOT NULL AND "matter_deadline"."satisfied_by" IS NOT NULL)
        OR ("matter_deadline"."state" <> 'satisfied' AND "matter_deadline"."satisfied_at" IS NULL AND "matter_deadline"."satisfied_by" IS NULL)),
	CONSTRAINT "matter_deadline_superseded_shape_check" CHECK(("matter_deadline"."superseded_by_deadline_id" IS NULL) OR ("matter_deadline"."state" = 'superseded')),
	CONSTRAINT "matter_deadline_priority_check" CHECK("matter_deadline"."priority" IS NULL OR "matter_deadline"."priority" > 0)
);
--> statement-breakpoint
CREATE TABLE `document_template_field_binding` (
	`template_version_id` text NOT NULL,
	`merge_key` text NOT NULL,
	PRIMARY KEY(`template_version_id`, `merge_key`),
	FOREIGN KEY (`template_version_id`) REFERENCES `document_template_version`(`id`),
	CONSTRAINT `document_template_field_binding_merge_key_nonempty_check` CHECK (length(`merge_key`) > 0)
);
--> statement-breakpoint
CREATE TABLE `matter_asset_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`class` text NOT NULL,
	`code` text,
	`active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_asset_type_name_check" CHECK(length("matter_asset_type"."name") > 0),
	CONSTRAINT "matter_asset_type_class_check" CHECK("matter_asset_type"."class" IN ('realProperty', 'financialAccount', 'vehicle', 'firearm', 'businessInterest', 'insurancePolicy', 'receivable', 'digitalAsset', 'personalProperty', 'other'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`class` text NOT NULL,
	`asset_type_id` text,
	`description` text NOT NULL,
	`acquired_on` text,
	`estate_treatment` text DEFAULT 'undetermined' NOT NULL,
	`disposition` text DEFAULT 'retained' NOT NULL,
	`disposition_on` text,
	`custody_item_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_type_id`) REFERENCES `matter_asset_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`custody_item_id`) REFERENCES `custody_item`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_description_check" CHECK(length("matter_asset"."description") > 0),
	CONSTRAINT "matter_asset_class_check" CHECK("matter_asset"."class" IN ('realProperty', 'financialAccount', 'vehicle', 'firearm', 'businessInterest', 'insurancePolicy', 'receivable', 'digitalAsset', 'personalProperty', 'other')),
	CONSTRAINT "matter_asset_estate_treatment_check" CHECK("matter_asset"."estate_treatment" IN ('probateEstate', 'nonProbateTransfer', 'undetermined')),
	CONSTRAINT "matter_asset_disposition_check" CHECK("matter_asset"."disposition" IN ('retained', 'sold', 'transferred', 'distributed', 'abandoned', 'lost'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_real_property` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`street` text,
	`city` text,
	`region` text,
	`postal` text,
	`county` text,
	`parcel_number` text,
	`legal_description` text,
	`recording_reference` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_asset_financial_account` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`institution_name` text,
	`institution_organization_id` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_asset_valuation` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`encumbrance_id` text,
	`as_of_date` text NOT NULL,
	`amount_minor` integer,
	`currency` text,
	`basis` text NOT NULL,
	`source_note` text,
	`supporting_file_id` text,
	`corrects_valuation_id` text,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supporting_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_valuation_as_of_shape_check" CHECK("matter_asset_valuation"."as_of_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_asset_valuation_amount_shape_check" CHECK(("matter_asset_valuation"."amount_minor" IS NULL) = ("matter_asset_valuation"."currency" IS NULL)),
	CONSTRAINT "matter_asset_valuation_basis_check" CHECK("matter_asset_valuation"."basis" IN ('appraisal', 'statement', 'taxAssessment', 'marketQuote', 'guideBook', 'broker', 'sale', 'purchasePrice', 'courtDetermined', 'clientEstimate', 'automatedEstimate'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_interest` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`interest_role` text,
	`share_numerator` integer,
	`share_denominator` integer,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_interest_share_shape_check" CHECK(("matter_asset_interest"."share_numerator" IS NULL) = ("matter_asset_interest"."share_denominator" IS NULL)),
	CONSTRAINT "matter_asset_interest_share_denominator_check" CHECK("matter_asset_interest"."share_denominator" IS NULL OR "matter_asset_interest"."share_denominator" > 0)
);
--> statement-breakpoint
CREATE TABLE `matter_asset_document` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`linked_at` text NOT NULL,
	`linked_by` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_document_kind_check" CHECK("matter_asset_document"."kind" IN ('deed', 'title', 'statement', 'appraisal', 'policy', 'registration', 'billOfSale', 'photograph', 'correspondence', 'other'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_identifier` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_suffix` text,
	`value_ciphertext` text,
	`created_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_identifier_kind_check" CHECK("matter_asset_identifier"."kind" IN ('accountNumber', 'policyNumber', 'certificateNumber', 'taxIdentifier', 'other')),
	CONSTRAINT "matter_asset_identifier_suffix_length_check" CHECK("matter_asset_identifier"."display_suffix" IS NULL OR length("matter_asset_identifier"."display_suffix") <= 4),
	CONSTRAINT "matter_asset_identifier_presence_check" CHECK("matter_asset_identifier"."display_suffix" IS NOT NULL OR "matter_asset_identifier"."value_ciphertext" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `magnus_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`created_by` text NOT NULL,
	`matter_id` text,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "magnus_conversation_state_check" CHECK("magnus_conversation"."state" IN ('active', 'archived', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE `magnus_member_acknowledgement` (
	`user_id` text PRIMARY KEY NOT NULL,
	`disclosure_version` integer NOT NULL,
	`acknowledged_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `magnus_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`speaker` text NOT NULL,
	`content` text,
	`status` text NOT NULL,
	`failure_label` text,
	`model_id` text,
	`snapshot_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`context_truncated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `magnus_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "magnus_turn_speaker_check" CHECK("magnus_turn"."speaker" IN ('member', 'magnus')),
	CONSTRAINT "magnus_turn_status_check" CHECK("magnus_turn"."status" IN ('pending', 'complete', 'failed', 'refused')),
	CONSTRAINT "magnus_turn_failure_label_check" CHECK("magnus_turn"."failure_label" IS NULL OR "magnus_turn"."failure_label" IN ('model-unavailable', 'not-eligible', 'ceiling-reached', 'too-large', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `invoice_application` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`trust_transfer_id` text,
	`reverses_application_id` text,
	`effective_date` text NOT NULL,
	`applied_by` text,
	`applied_at` text NOT NULL, `credit_note_id` text REFERENCES credit_note(id), `client_credit_id` text REFERENCES client_credit(id), `entry_id` text REFERENCES ledger_entry(id), `reason` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`trust_transfer_id`) REFERENCES `trust_transfer`(`id`),
	FOREIGN KEY (`reverses_application_id`) REFERENCES `invoice_application`(`id`),
	-- The whole closed set of kinds, including the four no code writes yet. SQLite cannot widen a
	-- CHECK without rebuilding the table, and a table rebuild is destructive DDL this schema does not
	-- permit against a table holding data — so narrowing this to what ships today would mean the
	-- credit-note and payment paths could never be added additively. The set is the design's, and the
	-- pairing CHECKs below are written so they stay true when the rest of it lands.
	CONSTRAINT `invoice_application_kind_check` CHECK (`kind` IN ('trust_transfer', 'payment', 'credit_note', 'client_credit', 'write_off', 'reversal')),
	-- Amounts are positive and direction is the row's KIND, never a sign — the ledger's rule applied
	-- to the subledger. A reversal carries a positive amount and subtracts because it is a reversal.
	CONSTRAINT `invoice_application_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `invoice_application_currency_check` CHECK (length(`currency`) = 3),
	-- A trust application names the transfer it came from, and nothing else may. This is the column
	-- that lets the no-double-credit rule be re-proved over stored rows: a trust application is
	-- exactly the case where billing composes NO ledger entry, because trust's transfer already
	-- credited accounts receivable on its operating leg.
	CONSTRAINT `invoice_application_trust_transfer_paired_check` CHECK ((`kind` = 'trust_transfer') = (`trust_transfer_id` IS NOT NULL)),
	CONSTRAINT `invoice_application_reversal_paired_check` CHECK ((`kind` = 'reversal') = (`reverses_application_id` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_business_interest` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`entity_name` text,
	`entity_organization_id` text,
	`jurisdiction_of_organization` text,
	`entity_form` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_asset_digital_asset` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`platform_name` text,
	`account_handle` text,
	`custody_model` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_digital_asset_custody_model_check" CHECK("matter_asset_digital_asset"."custody_model" IS NULL OR "matter_asset_digital_asset"."custody_model" IN ('custodial', 'selfCustodied', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_encumbrance` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`holder_entity_id` text,
	`holder_name` text,
	`recorded_reference` text,
	`released_on` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_encumbrance_kind_check" CHECK("matter_asset_encumbrance"."kind" IN ('mortgage', 'deedOfTrust', 'lien', 'judgment', 'securityInterest', 'taxLien', 'pledge', 'other'))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_firearm` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`make` text,
	`model` text,
	`caliber_or_gauge` text,
	`serial_number` text,
	`regulated_category` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_asset_insurance_policy` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`carrier_name` text,
	`carrier_organization_id` text,
	`face_amount_minor` integer,
	`face_currency` text,
	`insured_entity_id` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_insurance_policy_face_amount_check" CHECK(("matter_asset_insurance_policy"."face_amount_minor" IS NULL) = ("matter_asset_insurance_policy"."face_currency" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_receivable` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`debtor_entity_id` text,
	`principal_amount_minor` integer,
	`principal_currency` text,
	`rate_e4` integer,
	`maturity_on` text,
	`secured` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_receivable_principal_check" CHECK(("matter_asset_receivable"."principal_amount_minor" IS NULL) = ("matter_asset_receivable"."principal_currency" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `matter_asset_vehicle` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`make` text,
	`model` text,
	`model_year` integer,
	`vehicle_identification_number` text,
	`plate_number` text,
	`plate_region` text,
	FOREIGN KEY (`asset_id`) REFERENCES `matter_asset`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_asset_vehicle_model_year_check" CHECK("matter_asset_vehicle"."model_year" IS NULL OR ("matter_asset_vehicle"."model_year" >= 1885 AND "matter_asset_vehicle"."model_year" <= 2200))
);
--> statement-breakpoint
CREATE TABLE `review_set` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`name` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`document_ceiling` integer NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`semantic_index_enabled` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`locked_at` text,
	`closed_at` text,
	`derived_artifacts_released_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_set_state_check" CHECK("review_set"."state" IN ('open', 'locked', 'closed')),
	CONSTRAINT "review_set_name_nonempty_check" CHECK(length("review_set"."name") > 0),
	CONSTRAINT "review_set_ceiling_positive_check" CHECK("review_set"."document_ceiling" > 0),
	CONSTRAINT "review_set_document_count_nonnegative_check" CHECK("review_set"."document_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `record_custodian` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`display_name` text NOT NULL,
	`directory_entity_id` text,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "record_custodian_kind_check" CHECK("record_custodian"."kind" IN ('person', 'organization', 'unattributed')),
	CONSTRAINT "record_custodian_name_nonempty_check" CHECK(length("record_custodian"."display_name") > 0)
);
--> statement-breakpoint
CREATE TABLE `discovery_load` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`lane` text NOT NULL,
	`state` text DEFAULT 'declared' NOT NULL,
	`transcript_scope` text NOT NULL,
	`declared_document_count` integer DEFAULT 0 NOT NULL,
	`loaded_document_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`exception_count` integer DEFAULT 0 NOT NULL,
	`default_record_custodian_id` text,
	`source_description` text,
	`initiated_by` text NOT NULL,
	`initiated_at` text NOT NULL,
	`completed_at` text,
	`manifest_r2_key` text,
	`exception_report_r2_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_record_custodian_id`) REFERENCES `record_custodian`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_load_lane_check" CHECK("discovery_load"."lane" IN ('internal-files', 'internal-email', 'received-production', 'direct-collection')),
	CONSTRAINT "discovery_load_state_check" CHECK("discovery_load"."state" IN ('declared', 'loading', 'processing', 'complete', 'failed', 'reversed')),
	CONSTRAINT "discovery_load_transcript_scope_check" CHECK("discovery_load"."transcript_scope" IN ('exclude', 'include')),
	CONSTRAINT "discovery_load_counts_nonnegative_check" CHECK("discovery_load"."declared_document_count" >= 0 AND "discovery_load"."loaded_document_count" >= 0 AND "discovery_load"."processed_count" >= 0 AND "discovery_load"."exception_count" >= 0),
	CONSTRAINT "discovery_load_reconciliation_check" CHECK("discovery_load"."state" <> 'complete' OR "discovery_load"."loaded_document_count" = "discovery_load"."processed_count" + "discovery_load"."exception_count")
);
--> statement-breakpoint
CREATE TABLE `review_document` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`discovery_load_id` text NOT NULL,
	`record_custodian_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`file_version_id` text,
	`email_message_id` text,
	`family_id` text NOT NULL,
	`family_role` text DEFAULT 'standalone' NOT NULL,
	`family_sequence` integer DEFAULT 0 NOT NULL,
	`source_name` text,
	`source_path` text,
	`size_bytes` integer,
	`content_sha256` text,
	`content_md5` text,
	`content_sha1` text,
	`text_r2_key` text,
	`metadata_r2_key` text,
	`page_count` integer,
	`text_fingerprint` text,
	`dedup_group_id` text,
	`is_dedup_primary` integer DEFAULT true NOT NULL,
	`processing_state` text DEFAULT 'pending' NOT NULL,
	`format_identified` text,
	`sort_date` text,
	`sort_date_source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `extraction_route` text, `pages_recognized` integer CONSTRAINT `review_document_pages_recognized_check` CHECK (`pages_recognized` IS NULL OR `pages_recognized` >= 0), `processing_deferred_reason` text, `index_state` text, `index_deferred_reason` text,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discovery_load_id`) REFERENCES `discovery_load`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_custodian_id`) REFERENCES `record_custodian`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_source_kind_check" CHECK("review_document"."source_kind" IN ('file_version', 'email_message', 'email_attachment')),
	CONSTRAINT "review_document_exactly_one_source_check" CHECK(("review_document"."file_version_id" IS NOT NULL) + ("review_document"."email_message_id" IS NOT NULL) = 1),
	CONSTRAINT "review_document_processing_state_check" CHECK("review_document"."processing_state" IN ('pending', 'processing', 'processed', 'excepted')),
	CONSTRAINT "review_document_processed_names_format_check" CHECK("review_document"."processing_state" <> 'processed' OR "review_document"."format_identified" IS NOT NULL),
	CONSTRAINT "review_document_family_role_check" CHECK("review_document"."family_role" IN ('standalone', 'parent', 'attachment', 'container-child')),
	CONSTRAINT "review_document_standalone_family_check" CHECK("review_document"."family_role" <> 'standalone' OR "review_document"."family_id" = "review_document"."id")
);
--> statement-breakpoint
CREATE TABLE `review_document_exception` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`review_document_id` text NOT NULL,
	`stage` text NOT NULL,
	`code` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL, `discovery_load_id` text REFERENCES `discovery_load`(`id`),
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_exception_stage_check" CHECK("review_document_exception"."stage" IN ('load', 'identify', 'extract', 'deduplicate', 'family', 'index')),
	CONSTRAINT "review_document_exception_code_check" CHECK("review_document_exception"."code" IN ('unsupported-format', 'corrupt', 'encrypted', 'password-protected', 'encrypted-container-entry', 'container-not-expanded', 'container-guard-tripped', 'oversize', 'extraction-timeout', 'no-text-extracted', 'malware-flagged', 'conversion-failed', 'recognition-failed', 'load-file-metadata-mismatch', 'source-bytes-missing'))
);
--> statement-breakpoint
CREATE TABLE `review_document_occurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`primary_review_document_id` text NOT NULL,
	`duplicate_review_document_id` text NOT NULL,
	`record_custodian_id` text NOT NULL,
	`discovery_load_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`duplicate_review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_custodian_id`) REFERENCES `record_custodian`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discovery_load_id`) REFERENCES `discovery_load`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_occurrence_distinct_check" CHECK("review_document_occurrence"."primary_review_document_id" <> "review_document_occurrence"."duplicate_review_document_id")
);
--> statement-breakpoint
CREATE TABLE `notification_recipient` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_event_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`state` text DEFAULT 'unread' NOT NULL,
	`read_at` text,
	`dismissed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notification_event_id`) REFERENCES `notification_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_recipient_state_check" CHECK("notification_recipient"."state" IN ('unread', 'read', 'dismissed')),
	CONSTRAINT "notification_recipient_read_at_check" CHECK(("notification_recipient"."state" = 'read') = ("notification_recipient"."read_at" IS NOT NULL)),
	CONSTRAINT "notification_recipient_dismissed_at_check" CHECK(("notification_recipient"."state" = 'dismissed') = ("notification_recipient"."dismissed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_recipient_id` text NOT NULL,
	`channel` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`suppressed_reason` text,
	`digest_id` text,
	`dispatched_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notification_recipient_id`) REFERENCES `notification_recipient`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_delivery_suppressed_reason_check" CHECK(("notification_delivery"."state" = 'suppressed') = ("notification_delivery"."suppressed_reason" IS NOT NULL)),
	CONSTRAINT "notification_delivery_attempts_nonnegative_check" CHECK("notification_delivery"."attempts" >= 0),
	CONSTRAINT "notification_delivery_channel_check" CHECK("notification_delivery"."channel" IN ('in_app', 'email', 'push', 'sms', 'desktop')),
	CONSTRAINT "notification_delivery_state_check" CHECK("notification_delivery"."state" IN ('pending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "notification_delivery_suppressed_reason_value_check" CHECK("notification_delivery"."suppressed_reason" IS NULL OR "notification_delivery"."suppressed_reason" IN ('preference', 'not-visible', 'no-address', 'policy'))
);
--> statement-breakpoint
CREATE TABLE `notification_digest_run` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`cadence` text NOT NULL,
	`last_occurred_at` text,
	`last_event_id` text,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "notification_digest_run_cadence_check" CHECK("notification_digest_run"."cadence" IN ('daily', 'weekly')),
	CONSTRAINT "notification_digest_run_watermark_pair_check" CHECK(("notification_digest_run"."last_occurred_at" IS NULL) = ("notification_digest_run"."last_event_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `notification_swept_unread` (
	`recipient_user_id` text PRIMARY KEY NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`oldest_swept_occurred_at` text,
	`last_swept_at` text NOT NULL,
	CONSTRAINT "notification_swept_unread_count_nonnegative_check" CHECK("notification_swept_unread"."unread_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `matter_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`assignment_role` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "matter_assignment_role_nonempty_check" CHECK(length("matter_assignment"."assignment_role") > 0),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `member_professional_profile` (
	`member_user_id` text PRIMARY KEY NOT NULL,
	`title` text,
	`admissions` text,
	`direct_dial` text,
	`professional_email` text,
	`signature_block` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_court_case` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`court_entity_id` text,
	`judge_entity_id` text,
	`case_number` text,
	`division` text,
	`department` text,
	`filed_on` text,
	`client_designation` text,
	`opposing_designation` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_estate` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`decedent_entity_id` text,
	`estate_entity_id` text,
	`date_of_death` text,
	`estate_style` text,
	`short_style` text,
	`proceeding_type` text,
	`letters_issued_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "matter_estate_proceeding_type_check" CHECK("matter_estate"."proceeding_type" IS NULL OR "matter_estate"."proceeding_type" IN ('testate', 'intestate', 'small_estate', 'ancillary')),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trust_authorization_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`policy` text NOT NULL,
	`threshold_amount_minor` integer,
	`require_authorized_approver` integer NOT NULL,
	`set_by` text NOT NULL,
	`set_at` text NOT NULL,
	CONSTRAINT `trust_authorization_policy_policy_check` CHECK (`policy` IN ('off', 'threshold', 'always')),
	CONSTRAINT `trust_authorization_policy_threshold_shape_check` CHECK ((`policy` = 'threshold' AND `threshold_amount_minor` IS NOT NULL AND `threshold_amount_minor` >= 0) OR (`policy` <> 'threshold' AND `threshold_amount_minor` IS NULL)),
	CONSTRAINT `trust_authorization_policy_authority_flag_check` CHECK (`require_authorized_approver` IN (0, 1)),
	CONSTRAINT `trust_authorization_policy_version_positive_check` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE TABLE "trust_disbursement_decision" (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`decision` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text NOT NULL,
	`reason` text,
	`authorization_basis` text,
	`movement_id` text,
	`transfer_id` text,
	FOREIGN KEY (`request_id`) REFERENCES `trust_disbursement_request`(`id`),
	FOREIGN KEY (`movement_id`) REFERENCES `trust_movement`(`id`),
	FOREIGN KEY (`transfer_id`) REFERENCES `trust_transfer`(`id`),
	CONSTRAINT `trust_disbursement_decision_decision_check` CHECK (`decision` IN ('approved', 'rejected', 'withdrawn')),
	CONSTRAINT `trust_disbursement_decision_basis_check` CHECK (`authorization_basis` IS NULL OR `authorization_basis` IN ('second_person', 'sole_trust_manager', 'policy_exempt')),
	CONSTRAINT `trust_disbursement_decision_shape_check` CHECK ((`decision` = 'approved' AND `authorization_basis` IS NOT NULL AND `reason` IS NULL AND ((`movement_id` IS NOT NULL AND `transfer_id` IS NULL) OR (`transfer_id` IS NOT NULL AND `movement_id` IS NULL))) OR (`decision` = 'rejected' AND `authorization_basis` IS NULL AND `movement_id` IS NULL AND `transfer_id` IS NULL AND length(`reason`) > 0) OR (`decision` = 'withdrawn' AND `authorization_basis` IS NULL AND `movement_id` IS NULL AND `transfer_id` IS NULL AND (`reason` IS NULL OR length(`reason`) > 0)))
);
--> statement-breakpoint
CREATE TABLE `invoice_trust_application_line` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `trust_disbursement_request`(`id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	CONSTRAINT `invoice_trust_application_line_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `invoice_trust_application_line_currency_check` CHECK (length(`currency`) = 3)
);
--> statement-breakpoint
CREATE TABLE `matter_billing_arrangement` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`flat_fee_amount_minor` integer,
	`contingency_share_e4` integer,
	`contingency_basis` text,
	`retainer_target_minor` integer,
	`retainer_threshold_minor` integer,
	`advance_deposit_destination` text,
	`currency` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	`created_by` text, `agreement_file_id` text REFERENCES `file`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `matter_billing_arrangement_kind_check` CHECK (`kind` IN ('hourly', 'flat_fee', 'contingency', 'retainer')),
	CONSTRAINT `matter_billing_arrangement_version_positive_check` CHECK (`version` > 0),
	CONSTRAINT `matter_billing_arrangement_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `matter_billing_arrangement_kind_shape_check` CHECK ((`kind` = 'flat_fee') = (`flat_fee_amount_minor` IS NOT NULL) AND (`kind` = 'contingency') = (`contingency_share_e4` IS NOT NULL) AND (`kind` = 'contingency') = (`contingency_basis` IS NOT NULL) AND (`kind` = 'retainer') = (`retainer_target_minor` IS NOT NULL) AND (`kind` = 'retainer') = (`retainer_threshold_minor` IS NOT NULL)),
	CONSTRAINT `matter_billing_arrangement_flat_fee_positive_check` CHECK (`flat_fee_amount_minor` IS NULL OR `flat_fee_amount_minor` > 0),
	CONSTRAINT `matter_billing_arrangement_share_bounds_check` CHECK (`contingency_share_e4` IS NULL OR (`contingency_share_e4` > 0 AND `contingency_share_e4` <= 10000)),
	CONSTRAINT `matter_billing_arrangement_retainer_bounds_check` CHECK (`retainer_target_minor` IS NULL OR (`retainer_target_minor` > 0 AND `retainer_threshold_minor` >= 0 AND `retainer_threshold_minor` <= `retainer_target_minor`)),
	CONSTRAINT `matter_billing_arrangement_destination_check` CHECK (`advance_deposit_destination` IS NULL OR `advance_deposit_destination` IN ('trust', 'operating'))
);
--> statement-breakpoint
CREATE TABLE `matter_recovery` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`recovered_date` text NOT NULL,
	`description` text NOT NULL,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	CONSTRAINT `matter_recovery_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `matter_recovery_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `matter_recovery_description_nonempty_check` CHECK (length(`description`) > 0),
	CONSTRAINT `matter_recovery_void_paired_check` CHECK ((`voided_at` IS NULL) = (`void_reason` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `retainer_replenishment_request` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`arrangement_id` text NOT NULL,
	`observed_balance_minor` integer NOT NULL,
	`requested_amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`requested_at` text NOT NULL,
	`requested_by` text,
	`resolved_at` text,
	`resolved_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`arrangement_id`) REFERENCES `matter_billing_arrangement`(`id`),
	CONSTRAINT `retainer_replenishment_request_amount_positive_check` CHECK (`requested_amount_minor` > 0),
	CONSTRAINT `retainer_replenishment_request_observed_not_negative_check` CHECK (`observed_balance_minor` >= 0),
	CONSTRAINT `retainer_replenishment_request_currency_check` CHECK (length(`currency`) = 3)
);
--> statement-breakpoint
CREATE TABLE `firm_event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`status_reason` text,
	`starts_on` text NOT NULL,
	`starts_at_time` text,
	`ends_on` text,
	`ends_at_time` text,
	`time_zone` text NOT NULL,
	`audience` text DEFAULT 'participants' NOT NULL,
	`location_id` text,
	`location_text` text,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `matter_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_event_title_check" CHECK(length("firm_event"."title") > 0),
	CONSTRAINT "firm_event_status_check" CHECK("firm_event"."status" IN ('scheduled', 'occurred', 'cancelled')),
	CONSTRAINT "firm_event_audience_check" CHECK("firm_event"."audience" IN ('all_members', 'participants')),
	CONSTRAINT "firm_event_time_zone_check" CHECK(length("firm_event"."time_zone") > 0),
	CONSTRAINT "firm_event_starts_on_shape_check" CHECK("firm_event"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_event_ends_on_shape_check" CHECK("firm_event"."ends_on" IS NULL OR "firm_event"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_event_starts_at_time_shape_check" CHECK("firm_event"."starts_at_time" IS NULL OR "firm_event"."starts_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_event_ends_at_time_shape_check" CHECK("firm_event"."ends_at_time" IS NULL OR "firm_event"."ends_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_event_range_check" CHECK("firm_event"."ends_on" IS NULL OR "firm_event"."ends_on" >= "firm_event"."starts_on"),
	CONSTRAINT "firm_event_end_time_check" CHECK("firm_event"."ends_at_time" IS NULL OR "firm_event"."starts_at_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `firm_event_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_event_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`member_user_id` text,
	`entity_id` text,
	`participant_name` text,
	`role` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_user_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_event_participant_kind_check" CHECK("firm_event_participant"."participant_kind" IN ('member', 'entity', 'external')),
	CONSTRAINT "firm_event_participant_shape_check" CHECK(("firm_event_participant"."participant_kind" = 'member' AND "firm_event_participant"."member_user_id" IS NOT NULL)
        OR ("firm_event_participant"."participant_kind" = 'entity' AND "firm_event_participant"."entity_id" IS NOT NULL)
        OR ("firm_event_participant"."participant_kind" = 'external' AND "firm_event_participant"."participant_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `firm_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`location_id` text,
	`capacity` integer,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_resource_name_check" CHECK(length("firm_resource"."name") > 0),
	CONSTRAINT "firm_resource_kind_check" CHECK("firm_resource"."kind" IN ('room', 'vehicle', 'equipment', 'other')),
	CONSTRAINT "firm_resource_capacity_check" CHECK("firm_resource"."capacity" IS NULL OR "firm_resource"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE `firm_resource_booking` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`matter_event_id` text,
	`firm_event_id` text,
	`starts_on` text NOT NULL,
	`starts_at_time` text,
	`ends_on` text,
	`ends_at_time` text,
	`time_zone` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `firm_resource`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firm_resource_booking_event_shape_check" CHECK(("firm_resource_booking"."matter_event_id" IS NOT NULL AND "firm_resource_booking"."firm_event_id" IS NULL)
        OR ("firm_resource_booking"."matter_event_id" IS NULL AND "firm_resource_booking"."firm_event_id" IS NOT NULL)),
	CONSTRAINT "firm_resource_booking_time_zone_check" CHECK(length("firm_resource_booking"."time_zone") > 0),
	CONSTRAINT "firm_resource_booking_starts_on_shape_check" CHECK("firm_resource_booking"."starts_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_resource_booking_ends_on_shape_check" CHECK("firm_resource_booking"."ends_on" IS NULL OR "firm_resource_booking"."ends_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "firm_resource_booking_starts_at_time_shape_check" CHECK("firm_resource_booking"."starts_at_time" IS NULL OR "firm_resource_booking"."starts_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_resource_booking_ends_at_time_shape_check" CHECK("firm_resource_booking"."ends_at_time" IS NULL OR "firm_resource_booking"."ends_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "firm_resource_booking_range_check" CHECK("firm_resource_booking"."ends_on" IS NULL OR "firm_resource_booking"."ends_on" >= "firm_resource_booking"."starts_on"),
	CONSTRAINT "firm_resource_booking_end_time_check" CHECK("firm_resource_booking"."ends_at_time" IS NULL OR "firm_resource_booking"."starts_at_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `calendar_event_link` (
	`id` text PRIMARY KEY NOT NULL,
	`from_matter_event_id` text,
	`from_firm_event_id` text,
	`to_matter_event_id` text,
	`to_firm_event_id` text,
	`kind` text NOT NULL,
	`note` text,
	`recorded_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_matter_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_firm_event_id`) REFERENCES `firm_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendar_event_link_kind_check" CHECK("calendar_event_link"."kind" IN ('continuance_of', 'related')),
	CONSTRAINT "calendar_event_link_from_shape_check" CHECK(("calendar_event_link"."from_matter_event_id" IS NOT NULL AND "calendar_event_link"."from_firm_event_id" IS NULL)
        OR ("calendar_event_link"."from_matter_event_id" IS NULL AND "calendar_event_link"."from_firm_event_id" IS NOT NULL)),
	CONSTRAINT "calendar_event_link_to_shape_check" CHECK(("calendar_event_link"."to_matter_event_id" IS NOT NULL AND "calendar_event_link"."to_firm_event_id" IS NULL)
        OR ("calendar_event_link"."to_matter_event_id" IS NULL AND "calendar_event_link"."to_firm_event_id" IS NOT NULL)),
	CONSTRAINT "calendar_event_link_continuance_matter_check" CHECK("calendar_event_link"."kind" <> 'continuance_of' OR ("calendar_event_link"."from_matter_event_id" IS NOT NULL AND "calendar_event_link"."to_matter_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `review_set_access` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`member_user_id` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_tag_group` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`cardinality` text NOT NULL,
	`required_for_completion` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_tag_group_kind_check" CHECK("review_tag_group"."kind" IN ('system', 'custom')),
	CONSTRAINT "review_tag_group_cardinality_check" CHECK("review_tag_group"."cardinality" IN ('single', 'multi')),
	CONSTRAINT "review_tag_group_name_nonempty_check" CHECK(length("review_tag_group"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE `review_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`review_tag_group_id` text NOT NULL,
	`review_set_id` text NOT NULL,
	`name` text NOT NULL,
	`semantic` text,
	`color_token` text NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_tag_group_id`) REFERENCES `review_tag_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_tag_semantic_check" CHECK("review_tag"."semantic" IS NULL OR "review_tag"."semantic" IN ('responsive', 'non-responsive', 'needs-further-review', 'privileged', 'privileged-redact', 'not-privileged', 'confidential')),
	CONSTRAINT "review_tag_name_nonempty_check" CHECK(length("review_tag"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE `review_tag_event` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`kind` text NOT NULL,
	`review_tag_id` text NOT NULL,
	`scope` text NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`criteria` text,
	`selection_r2_key` text,
	`state` text DEFAULT 'running' NOT NULL,
	`reverses_event_id` text,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_tag_id`) REFERENCES `review_tag`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_tag_event_kind_check" CHECK("review_tag_event"."kind" IN ('apply', 'remove', 'bulk-apply', 'bulk-remove', 'undo')),
	CONSTRAINT "review_tag_event_scope_check" CHECK("review_tag_event"."scope" IN ('document', 'family', 'selection')),
	CONSTRAINT "review_tag_event_state_check" CHECK("review_tag_event"."state" IN ('running', 'complete', 'undone')),
	CONSTRAINT "review_tag_event_document_count_check" CHECK("review_tag_event"."document_count" >= 0),
	CONSTRAINT "review_tag_event_reverses_check" CHECK(("review_tag_event"."kind" = 'undo') = ("review_tag_event"."reverses_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `review_document_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`review_set_id` text NOT NULL,
	`review_document_id` text NOT NULL,
	`review_tag_id` text NOT NULL,
	`review_tag_group_id` text NOT NULL,
	`single_choice` integer NOT NULL,
	`applied_by_event_id` text NOT NULL,
	`applied_at` text NOT NULL,
	`removed_by_event_id` text,
	`removed_at` text,
	FOREIGN KEY (`review_set_id`) REFERENCES `review_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_document_id`) REFERENCES `review_document`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_tag_id`) REFERENCES `review_tag`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_tag_group_id`) REFERENCES `review_tag_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_by_event_id`) REFERENCES `review_tag_event`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_document_tag_removal_check" CHECK(("review_document_tag"."removed_at" IS NULL) = ("review_document_tag"."removed_by_event_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `trust_firm_funds_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`entry_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`description` text NOT NULL,
	`recorded_by` text NOT NULL,
	`effective_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_firm_funds_movement_amount_positive_check" CHECK("trust_firm_funds_movement"."amount_minor" > 0),
	CONSTRAINT "trust_firm_funds_movement_currency_check" CHECK(length("trust_firm_funds_movement"."currency") = 3),
	CONSTRAINT "trust_firm_funds_movement_description_nonempty_check" CHECK(length("trust_firm_funds_movement"."description") > 0),
	CONSTRAINT "trust_firm_funds_movement_kind_check" CHECK("trust_firm_funds_movement"."kind" IN ('firm_funds_deposit', 'bank_charge')),
	CONSTRAINT "trust_firm_funds_movement_shape_check" CHECK(("trust_firm_funds_movement"."kind" = 'bank_charge' AND "trust_firm_funds_movement"."method" = 'bank_debit')
        OR ("trust_firm_funds_movement"."kind" = 'firm_funds_deposit' AND "trust_firm_funds_movement"."method" <> 'bank_debit'))
);
--> statement-breakpoint
CREATE TABLE `trust_unclaimed_funds_contact_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`channel` text NOT NULL,
	`attempted_on` text NOT NULL,
	`contact_used` text,
	`outcome` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `trust_unclaimed_funds_review`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_unclaimed_funds_contact_attempt_channel_check" CHECK("trust_unclaimed_funds_contact_attempt"."channel" IN ('regular_mail', 'certified_mail', 'telephone', 'email', 'record_review', 'other')),
	CONSTRAINT "trust_unclaimed_funds_contact_attempt_outcome_check" CHECK("trust_unclaimed_funds_contact_attempt"."outcome" IN ('no_response', 'undeliverable', 'reached', 'declined', 'wrong_contact', 'other')),
	CONSTRAINT "trust_unclaimed_funds_contact_attempt_shape_check" CHECK(("trust_unclaimed_funds_contact_attempt"."channel" = 'record_review' AND "trust_unclaimed_funds_contact_attempt"."contact_used" IS NULL)
        OR ("trust_unclaimed_funds_contact_attempt"."channel" <> 'record_review' AND "trust_unclaimed_funds_contact_attempt"."contact_used" IS NOT NULL AND length("trust_unclaimed_funds_contact_attempt"."contact_used") > 0))
);
--> statement-breakpoint
CREATE TABLE `trust_unclaimed_funds_review` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`node_id` text NOT NULL,
	`observed_balance_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`observed_earliest_receipt_date` text,
	`observed_last_activity_date` text,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `trust_ledger_node`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_unclaimed_funds_review_balance_positive_check" CHECK("trust_unclaimed_funds_review"."observed_balance_minor" > 0),
	CONSTRAINT "trust_unclaimed_funds_review_currency_check" CHECK(length("trust_unclaimed_funds_review"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE `trust_unclaimed_funds_review_closure` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`outcome` text NOT NULL,
	`movement_id` text,
	`closed_by` text NOT NULL,
	`closed_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`review_id`) REFERENCES `trust_unclaimed_funds_review`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movement_id`) REFERENCES `trust_movement`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_unclaimed_funds_review_closure_outcome_check" CHECK("trust_unclaimed_funds_review_closure"."outcome" IN ('distributed_to_owner', 'resolved_without_distribution', 'not_dormant', 'search_continues')),
	CONSTRAINT "trust_unclaimed_funds_review_closure_shape_check" CHECK(("trust_unclaimed_funds_review_closure"."outcome" = 'distributed_to_owner' AND "trust_unclaimed_funds_review_closure"."movement_id" IS NOT NULL)
        OR ("trust_unclaimed_funds_review_closure"."outcome" <> 'distributed_to_owner' AND "trust_unclaimed_funds_review_closure"."movement_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `credit_note` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`currency` text NOT NULL,
	`reason` text NOT NULL,
	`effective_date` text NOT NULL,
	`entry_id` text NOT NULL,
	`issued_by` text,
	`issued_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`),
	CONSTRAINT `credit_note_currency_check` CHECK (length(`currency`) = 3),
	-- Not optional and not a code. A credit note is read years later by somebody reconstructing a fee
	-- dispute, and a reason vocabulary the platform invented would flatten the one fact only the firm
	-- has.
	CONSTRAINT `credit_note_reason_nonempty_check` CHECK (length(trim(`reason`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `credit_note_line` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`credits_invoice_line_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`),
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`credits_invoice_line_id`) REFERENCES `invoice_line`(`id`),
	-- POSITIVE, unlike an invoice line. An invoice line may be negative because a discount is one
	-- line among many on a document whose direction is "you owe us"; a credit note's direction is the
	-- document's, so its lines carry magnitude only. The ledger's own rule, one level up.
	CONSTRAINT `credit_note_line_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `credit_note_line_currency_check` CHECK (length(`currency`) = 3),
	CONSTRAINT `credit_note_line_kind_check` CHECK (`kind` IN ('fee', 'cost', 'flat_fee', 'discount', 'adjustment', 'interest', 'tax'))
);
--> statement-breakpoint
CREATE TABLE `client_credit` (
	`id` text PRIMARY KEY NOT NULL,
	`client_entity_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`credit_note_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`discharged_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`opened_by` text,
	`opened_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`),
	CONSTRAINT `client_credit_amount_positive_check` CHECK (`amount_minor` > 0),
	CONSTRAINT `client_credit_currency_check` CHECK (length(`currency`) = 3),
	-- The guarantee, and the reason there is no status column. Two discharges racing for the same
	-- remainder both read it as available; the second one drives `discharged_minor` past `amount_minor`
	-- and aborts its WHOLE batch, ledger entry included. `account_balance` and `invoice_matter_balance`
	-- are the same arrangement for the same reason: D1 has no interactive transactions, so a bounds
	-- CHECK is the only mechanism that can abort a batch on a business condition.
	CONSTRAINT `client_credit_bounds_check` CHECK (`discharged_minor` >= 0 AND `discharged_minor` <= `amount_minor`)
);
--> statement-breakpoint
CREATE TABLE `index_split_member` (
	`split_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`superseded_at` text,
	PRIMARY KEY(`split_id`, `document_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `conflicts_recheck_request` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`cause_topic` text NOT NULL,
	`cause_reference` text NOT NULL,
	`cause_occurred_at` text NOT NULL,
	`requested_at` text NOT NULL,
	`satisfied_by_check_id` text,
	`satisfied_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`),
	FOREIGN KEY (`satisfied_by_check_id`) REFERENCES `conflicts_check`(`id`),
	CONSTRAINT `conflicts_recheck_request_cause_topic_check` CHECK (length(`cause_topic`) > 0),
	CONSTRAINT `conflicts_recheck_request_cause_reference_check` CHECK (length(`cause_reference`) > 0),
	CONSTRAINT `conflicts_recheck_request_satisfaction_check` CHECK ((`satisfied_by_check_id` IS NULL) = (`satisfied_at` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `ai_search_feed_object` (
	`file_id` text NOT NULL,
	`version` integer NOT NULL,
	`matter_id` text NOT NULL,
	`object_key` text NOT NULL,
	`byte_count` integer NOT NULL,
	`fed_at` text NOT NULL,
	`removed_at` text,
	PRIMARY KEY(`file_id`, `version`),
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_search_feed_object_version_positive_check" CHECK("ai_search_feed_object"."version" > 0),
	CONSTRAINT "ai_search_feed_object_byte_count_nonnegative_check" CHECK("ai_search_feed_object"."byte_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `ai_search_usage_meter` (
	`day` text PRIMARY KEY NOT NULL,
	`semantic_query_count` integer DEFAULT 0 NOT NULL,
	`full_text_query_count` integer DEFAULT 0 NOT NULL,
	`fed_bytes` integer DEFAULT 0 NOT NULL,
	`estimated_ingestion_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_ingestion_bytes_per_token` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_search_usage_meter_semantic_query_count_check" CHECK("ai_search_usage_meter"."semantic_query_count" >= 0),
	CONSTRAINT "ai_search_usage_meter_full_text_query_count_check" CHECK("ai_search_usage_meter"."full_text_query_count" >= 0),
	CONSTRAINT "ai_search_usage_meter_fed_bytes_check" CHECK("ai_search_usage_meter"."fed_bytes" >= 0),
	CONSTRAINT "ai_search_usage_meter_estimated_ingestion_tokens_check" CHECK("ai_search_usage_meter"."estimated_ingestion_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE `ai_search_disclosure_acknowledgement` (
	`scope` text PRIMARY KEY NOT NULL,
	`disclosure_version` integer NOT NULL,
	`acknowledged_by` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_search_disclosure_acknowledgement_scope_check" CHECK("ai_search_disclosure_acknowledgement"."scope" = 'firm')
);
--> statement-breakpoint
CREATE TABLE `nickname_equivalence` (
	`name_form` text NOT NULL,
	`equivalent_form` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`name_form`, `equivalent_form`),
	CONSTRAINT `nickname_equivalence_name_form_check` CHECK (length(`name_form`) > 0),
	CONSTRAINT `nickname_equivalence_equivalent_form_check` CHECK (length(`equivalent_form`) > 0)
);
--> statement-breakpoint
CREATE TABLE `invoice_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`channel` text NOT NULL,
	`recipient_reference` text NOT NULL,
	`delivery_date` text NOT NULL,
	`external_reference` text,
	`outcome` text NOT NULL,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`),
	-- A CLOSED VOCABULARY, and closed now rather than later on purpose: SQLite cannot widen a table
	-- CHECK without a destructive rebuild, so the channels a bill actually reaches a client by are
	-- enumerated once. `client_portal` is here with nothing yet able to produce it — the portal is
	-- unbuilt — because the alternative is a rebuild of a financial-evidence table on the day it
	-- lands.
	CONSTRAINT `invoice_delivery_channel_check` CHECK (`channel` IN ('email', 'post', 'hand', 'client_portal', 'e_billing_gateway')),
	-- WHO IT WENT TO, in the firm's own words: an address, a mailbox, a portal account, or the person
	-- it was handed to. Free text with no structured subject, on the same footing as the contact a
	-- firm records using to reach a client it holds unclaimed money for. Required and non-empty,
	-- because a record whose whole job is to answer "was this given to the client" and which cannot
	-- say who received it answers nothing.
	CONSTRAINT `invoice_delivery_recipient_nonempty_check` CHECK (length(trim(`recipient_reference`)) > 0),
	-- Two values, and the second is why the column exists: a letter comes back, an address is dead, a
	-- gateway submission is rejected. A firm that can only record successes has a delivery history
	-- that reads as complete when it is not, and a reminder sent on the strength of it would be a
	-- reminder about a bill nobody received.
	CONSTRAINT `invoice_delivery_outcome_check` CHECK (`outcome` IN ('delivered', 'failed')),
	-- An external handle only where the channel has one — a tracking number, a gateway submission id,
	-- the message id of a mail sent elsewhere. Present it is the thread back to the system that
	-- carried the bill; absent it means nothing was carried by a system, which is the ordinary case
	-- for hand delivery.
	CONSTRAINT `invoice_delivery_external_reference_nonempty_check` CHECK (`external_reference` IS NULL OR length(trim(`external_reference`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `download_item` (
	`id` text PRIMARY KEY NOT NULL,
	-- WHOSE SHELF. Every read is scoped to this column, never to the firm alone: a colleague's
	-- exports are not the reader's business. A bundle is content-addressed and genuinely shared
	-- between two members who selected the same files — the artifact is shared, these rows are not.
	`member_id` text NOT NULL,
	-- What the reader sees. Composed by the producer from what the member asked for ("Firm Usage",
	-- the matter and file count of a bundle) — never a key, never an identifier.
	`title` text NOT NULL,
	-- TWO KINDS, and the distinction decides what "download again" does.
	--   artifact — bytes the platform built that cannot be re-derived: a bundle of the firm's own
	--     files, a conversion result. `object_key` points at them and a re-download mints a fresh
	--     short-TTL presigned GET. When the prefix's own lifecycle rule has reaped the object the row
	--     reports expired rather than handing over a dead link.
	--   snapshot — an export: the tabular DOCUMENT a screen built from what it was showing, stored
	--     instead of a rendered file, because this platform holds that an export is a document and
	--     formats are renderers. One row therefore serves every format, and the figures are frozen at
	--     the instant of the export rather than recomputed into a different answer later.
	`kind` text NOT NULL,
	-- WHICH PRODUCER made it. Closed, and closed now rather than later: SQLite cannot widen a table
	-- CHECK without a destructive rebuild. `bundle` and `conversion` are here with no client able to
	-- create one yet — both producers exist server-side and neither has a screen — because the
	-- alternative is rebuilding this table on the day one lands.
	`producer` text NOT NULL,
	-- The R2 key. For an artifact it is the producer's own key under the producer's own prefix, which
	-- is what keeps this table a catalog rather than a second store. For a snapshot it is this
	-- register's own object holding the stored document, keyed by this row's id, and it is swept with
	-- the row.
	`object_key` text NOT NULL,
	-- Bytes, where the producer knows them. Null on a snapshot, whose size is a property of a
	-- rendering nobody has asked for yet rather than of the row.
	`byte_size` integer,
	-- WHAT HAS BEEN TAKEN — a JSON array of format tokens, appended to rather than replaced. This is
	-- the half of the owner's ask that a plain list does not answer: a member who can see they
	-- already took the Word copy is looking at a shelf, and one who cannot is looking at a pile.
	-- Empty array means built and never fetched, which is a real and visible state.
	`downloaded_formats_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	-- When the shelf lets go. Written by the producer from one constant so that a row and the
	-- lifecycle rule over its prefix cannot drift into the register outliving the bytes it points at.
	`expires_at` text NOT NULL,
	-- THE STATE, and `building` is the reason it is a column rather than a derivation. A bundle is
	-- enqueued before its bytes exist, so the row appears on the shelf while the work is still
	-- running; a member watching a large archive build should see it here rather than wonder whether
	-- the request was taken. `failed` is terminal and keeps the row so the member learns the outcome
	-- instead of watching it vanish. `expired` is written by the sweep, but a read that finds the
	-- object already gone reports it without waiting for the sweep to catch up.
	`state` text NOT NULL, `requested_format` text,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`user_id`),
	CONSTRAINT `download_item_kind_check` CHECK (`kind` IN ('artifact', 'snapshot')),
	CONSTRAINT `download_item_producer_check` CHECK (`producer` IN ('export', 'bundle', 'conversion')),
	CONSTRAINT `download_item_state_check` CHECK (`state` IN ('building', 'ready', 'failed', 'expired')),
	CONSTRAINT `download_item_title_nonempty_check` CHECK (length(trim(`title`)) > 0),
	CONSTRAINT `download_item_object_key_nonempty_check` CHECK (length(trim(`object_key`)) > 0),
	-- A snapshot has no byte size and an artifact's is never negative; a size of zero is a real
	-- answer (an empty archive) and stays representable.
	CONSTRAINT `download_item_byte_size_check` CHECK (`byte_size` IS NULL OR `byte_size` >= 0)
);
--> statement-breakpoint
CREATE TABLE "matter_note" (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`last_edited_by` text,
	`occurred_on` text,
	`occurred_at_time` text,
	`time_zone` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_note_body_check" CHECK(length("matter_note"."body") > 0),
	CONSTRAINT "matter_note_occurred_on_shape_check" CHECK("matter_note"."occurred_on" IS NULL OR "matter_note"."occurred_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_note_occurred_at_time_shape_check" CHECK("matter_note"."occurred_at_time" IS NULL OR "matter_note"."occurred_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_note_occurrence_shape_check" CHECK(("matter_note"."occurred_at_time" IS NULL OR "matter_note"."occurred_on" IS NOT NULL)
        AND ("matter_note"."occurred_at_time" IS NULL) = ("matter_note"."time_zone" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `matter_note_document` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`file_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by` text,
	FOREIGN KEY (`note_id`) REFERENCES `matter_note`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_entry_number_counter` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entry_number_allocation` (
	`scope_key` text NOT NULL,
	`drawn_value` integer NOT NULL,
	`time_entry_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `drawn_value`),
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_entry_attachment` (
	`time_entry_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	PRIMARY KEY(`time_entry_id`, `file_id`),
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matter_task` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text,
	`title` text NOT NULL,
	`body` text,
	`assignee_user_id` text,
	`created_by` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_on` text,
	`due_at_time` text,
	`time_zone` text,
	`state` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`completed_by` text,
	`cancelled_at` text,
	`cancelled_by` text,
	`cancellation_reason` text,
	`blocked_by_task_id` text,
	`trigger_event_id` text,
	`deadline_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `plan_template_id` text REFERENCES matter_plan_template(id), `plan_task_template_id` text REFERENCES matter_plan_task_template(id), `updated_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_event_id`) REFERENCES `matter_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deadline_id`) REFERENCES `matter_deadline`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_title_check" CHECK(length("matter_task"."title") > 0),
	CONSTRAINT "matter_task_priority_check" CHECK("matter_task"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "matter_task_state_check" CHECK("matter_task"."state" IN ('open', 'done', 'cancelled')),
	CONSTRAINT "matter_task_due_on_shape_check" CHECK("matter_task"."due_on" IS NULL OR "matter_task"."due_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "matter_task_due_at_time_shape_check" CHECK("matter_task"."due_at_time" IS NULL OR "matter_task"."due_at_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "matter_task_due_shape_check" CHECK(("matter_task"."due_at_time" IS NULL OR "matter_task"."due_on" IS NOT NULL)
        AND ("matter_task"."due_on" IS NULL) = ("matter_task"."time_zone" IS NULL)),
	CONSTRAINT "matter_task_completion_shape_check" CHECK(("matter_task"."state" = 'done' AND "matter_task"."completed_at" IS NOT NULL AND "matter_task"."completed_by" IS NOT NULL)
        OR ("matter_task"."state" != 'done' AND "matter_task"."completed_at" IS NULL AND "matter_task"."completed_by" IS NULL)),
	CONSTRAINT "matter_task_cancellation_shape_check" CHECK(("matter_task"."state" = 'cancelled' AND "matter_task"."cancelled_at" IS NOT NULL AND "matter_task"."cancelled_by" IS NOT NULL
          AND "matter_task"."cancellation_reason" IS NOT NULL AND length("matter_task"."cancellation_reason") > 0)
        OR ("matter_task"."state" != 'cancelled' AND "matter_task"."cancelled_at" IS NULL AND "matter_task"."cancelled_by" IS NULL
          AND "matter_task"."cancellation_reason" IS NULL)),
	CONSTRAINT "matter_task_blocked_by_self_check" CHECK("matter_task"."blocked_by_task_id" != "matter_task"."id")
);
--> statement-breakpoint
CREATE TABLE `matter_task_document` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`file_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE "notification_event" (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`matter_id` text,
	`occurred_at` text NOT NULL,
	`facts` text,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_event_category_check" CHECK("notification_event"."category" IN ('deadlines', 'calendar', 'tasks', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')),
	CONSTRAINT "notification_event_severity_check" CHECK("notification_event"."severity" IN ('informational', 'attention', 'critical')),
	CONSTRAINT "notification_event_subject_kind_check" CHECK("notification_event"."subject_kind" IN ('matter', 'matterEvent', 'matterDeadline', 'matterAsset', 'invoice', 'ledgerEntry', 'trustMovement', 'file', 'fileVersion', 'documentCheckout', 'directoryEntity', 'location', 'shipment', 'emailMessage', 'emailCaptureAddress', 'custodyPacket', 'custodyItem', 'custodyMovement', 'conflictsCheck', 'incident', 'magnusConversation', 'reviewSet', 'discoveryLoad', 'conversionJob', 'documentAssembly', 'bundleBuild', 'searchIndexJob', 'recoveryJob', 'member', 'matterTask'))
);
--> statement-breakpoint
CREATE TABLE "notification_in_app_suppression" (
	`recipient_user_id` text NOT NULL,
	`category` text NOT NULL,
	`civil_date` text NOT NULL,
	`suppressed_count` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`last_suppressed_at` text NOT NULL,
	PRIMARY KEY(`recipient_user_id`, `category`, `civil_date`, `reason`),
	CONSTRAINT "notification_in_app_suppression_count_nonnegative_check" CHECK("notification_in_app_suppression"."suppressed_count" >= 0),
	CONSTRAINT "notification_in_app_suppression_category_check" CHECK("notification_in_app_suppression"."category" IN ('deadlines', 'calendar', 'tasks', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')),
	CONSTRAINT "notification_in_app_suppression_reason_check" CHECK("notification_in_app_suppression"."reason" IN ('member-preference', 'firm-policy'))
);
--> statement-breakpoint
CREATE TABLE `matter_plan_task_template` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`default_assignee_role` text,
	`due_anchor` text DEFAULT 'none' NOT NULL,
	`offset_days` integer,
	`blocked_by_template_task_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `matter_plan_template`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_plan_task_template_title_check" CHECK(length("matter_plan_task_template"."title") > 0),
	CONSTRAINT "matter_plan_task_template_priority_check" CHECK("matter_plan_task_template"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "matter_plan_task_template_due_anchor_check" CHECK("matter_plan_task_template"."due_anchor" IN ('matter_opened', 'none')),
	CONSTRAINT "matter_plan_task_template_offset_shape_check" CHECK(("matter_plan_task_template"."due_anchor" = 'none' AND "matter_plan_task_template"."offset_days" IS NULL)
        OR ("matter_plan_task_template"."due_anchor" != 'none' AND "matter_plan_task_template"."offset_days" IS NOT NULL)),
	CONSTRAINT "matter_plan_task_template_blocked_by_self_check" CHECK("matter_plan_task_template"."blocked_by_template_task_id" != "matter_plan_task_template"."id")
);
--> statement-breakpoint
CREATE TABLE `matter_plan_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`matter_type_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_plan_template_name_nonempty_check" CHECK(length("matter_plan_template"."name") > 0),
	CONSTRAINT "matter_plan_template_active_check" CHECK("matter_plan_template"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `matter_task_deletion` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`matter_id` text,
	`deleted_at` text NOT NULL,
	`deleted_by` text
);
--> statement-breakpoint
CREATE TABLE `matter_task_external_link` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`system` text NOT NULL,
	`external_id` text NOT NULL,
	`external_url` text,
	`remote_revision` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `matter_task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_task_external_link_system_nonempty_check" CHECK(length("matter_task_external_link"."system") > 0),
	CONSTRAINT "matter_task_external_link_external_id_nonempty_check" CHECK(length("matter_task_external_link"."external_id") > 0)
);
--> statement-breakpoint
CREATE TABLE `intake_procedure` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`matter_type_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_procedure_name_nonempty_check" CHECK(length("intake_procedure"."name") > 0),
	CONSTRAINT "intake_procedure_active_check" CHECK("intake_procedure"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `matter_intake_step_record` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`procedure_step_id` text NOT NULL,
	`outcome` text NOT NULL,
	`rationale` text,
	`note` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	`superseded_at` text,
	`superseded_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_step_id`) REFERENCES `intake_procedure_step`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_intake_step_record_outcome_check" CHECK("matter_intake_step_record"."outcome" IN ('completed', 'waived')),
	CONSTRAINT "matter_intake_step_record_waiver_rationale_check" CHECK("matter_intake_step_record"."outcome" != 'waived' OR ("matter_intake_step_record"."rationale" IS NOT NULL AND length("matter_intake_step_record"."rationale") > 0))
);
--> statement-breakpoint
CREATE TABLE "intake_procedure_step" (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text,
	`required` integer DEFAULT 1 NOT NULL,
	`reference_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`procedure_id`) REFERENCES `intake_procedure`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_procedure_step_title_nonempty_check" CHECK(length("intake_procedure_step"."title") > 0),
	CONSTRAINT "intake_procedure_step_kind_check" CHECK("intake_procedure_step"."kind" IN ('conflicts-check', 'fee-agreement', 'engagement-letter', 'document', 'questionnaire', 'retainer', 'identity-verification', 'acknowledgement', 'client-forms', 'payment')),
	CONSTRAINT "intake_procedure_step_required_check" CHECK("intake_procedure_step"."required" IN (0, 1)),
	CONSTRAINT "intake_procedure_step_active_check" CHECK("intake_procedure_step"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "matter" (
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
	`natural_language_index_excluded` integer DEFAULT 0 NOT NULL,
	`matter_number` text,
	`numbered_at` text,
	`consultation_number` text,
	`system_key` text,
	`opened_at` text,
	`held_at` text,
	`hold_reason` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_type_id`) REFERENCES `matter_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_status_check" CHECK("matter"."status" IN ('intake', 'consultation', 'open', 'hold', 'closed')),
	CONSTRAINT "matter_hold_check" CHECK(("matter"."held_at" IS NULL) = ("matter"."hold_reason" IS NULL)),
	CONSTRAINT "matter_title_nonempty_check" CHECK(length("matter"."title") > 0),
	CONSTRAINT "matter_e_billing_check" CHECK("matter"."e_billing" IN (0, 1)),
	CONSTRAINT "matter_natural_language_index_excluded_check" CHECK("matter"."natural_language_index_excluded" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `communication` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`matter_id` text,
	`counterparty_number` text NOT NULL,
	`counterparty_entity_id` text,
	`member_user_id` text,
	`occurred_at` text NOT NULL,
	`duration_seconds` integer,
	`body` text,
	`summary` text,
	`producer` text NOT NULL,
	`logged_by_user_id` text,
	`carrier_reference` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_counterparty_number_check" CHECK(length("communication"."counterparty_number") > 0),
	CONSTRAINT "communication_channel_check" CHECK("communication"."channel" IN ('voice', 'sms', 'mms')),
	CONSTRAINT "communication_direction_check" CHECK("communication"."direction" IN ('inbound', 'outbound')),
	CONSTRAINT "communication_producer_check" CHECK("communication"."producer" IN ('member', 'carrier')),
	CONSTRAINT "communication_duration_channel_check" CHECK("communication"."duration_seconds" IS NULL OR ("communication"."channel" = 'voice' AND "communication"."duration_seconds" >= 0)),
	CONSTRAINT "communication_body_channel_check" CHECK("communication"."body" IS NULL OR "communication"."channel" IN ('sms', 'mms')),
	CONSTRAINT "communication_producer_shape_check" CHECK(("communication"."producer" = 'member') = ("communication"."logged_by_user_id" IS NOT NULL)
        AND ("communication"."producer" = 'carrier' OR "communication"."carrier_reference" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `ai_detection_usage_created_at_index` ON `ai_detection_usage` (`created_at`);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_index` ON `audit_log` (`created_at`);
--> statement-breakpoint
CREATE INDEX `audit_log_event_index` ON `audit_log` (`event`);
--> statement-breakpoint
CREATE INDEX `cost_entry_matter_status_index` ON `cost_entry` (`matter_id`,`status`);
--> statement-breakpoint
CREATE INDEX `cost_entry_status_incurred_date_index` ON `cost_entry` (`status`,`incurred_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_entry_recovery_ref_unique` ON `cost_entry` (`recovery_ref`) WHERE "cost_entry"."recovery_ref" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `custom_field_scope_index` ON `custom_field` (`target`,`attachment_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_value_current_unique_index` ON `custom_field_value` (`target_row_id`,`field_id`) WHERE "custom_field_value"."is_current" = 1;
--> statement-breakpoint
CREATE INDEX `custom_field_value_record_index` ON `custom_field_value` (`target_row_id`,`is_current`);
--> statement-breakpoint
CREATE INDEX `custom_field_value_field_index` ON `custom_field_value` (`field_id`);
--> statement-breakpoint
CREATE INDEX `custom_field_value_reference_index` ON `custom_field_value` (`value_reference_id`);
--> statement-breakpoint
CREATE INDEX `direct_grant_member_user_id_index` ON `direct_grant` (`member_user_id`);
--> statement-breakpoint
CREATE INDEX `directory_address_entity_id_index` ON `directory_address` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `directory_edge_from_entity_id_index` ON `directory_edge` (`from_entity_id`);
--> statement-breakpoint
CREATE INDEX `directory_edge_to_entity_id_index` ON `directory_edge` (`to_entity_id`);
--> statement-breakpoint
CREATE INDEX `directory_email_entity_id_index` ON `directory_email` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `directory_identifier_entity_id_index` ON `directory_identifier` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `directory_identifier_type_blind_index_index` ON `directory_identifier` (`identifier_type`,`value_blind_index`);
--> statement-breakpoint
CREATE INDEX `directory_name_entity_id_index` ON `directory_name` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `directory_name_normalized_display_index` ON `directory_name` (`normalized_display`);
--> statement-breakpoint
CREATE INDEX `directory_name_phonetic_code_scheme_code_index` ON `directory_name_phonetic_code` (`scheme`,`code`);
--> statement-breakpoint
CREATE INDEX `directory_name_phonetic_code_code_index` ON `directory_name_phonetic_code` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `directory_party_role_name_unique_index` ON `directory_party_role` (`name`);
--> statement-breakpoint
CREATE INDEX `directory_phone_entity_id_index` ON `directory_phone` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `document_checkout_file_id_index` ON `document_checkout` (`file_id`);
--> statement-breakpoint
CREATE INDEX `document_checkout_holder_member_id_index` ON `document_checkout` (`holder_member_id`);
--> statement-breakpoint
CREATE INDEX `document_checkout_status_last_activity_index` ON `document_checkout` (`status`,`last_activity_at`);
--> statement-breakpoint
CREATE INDEX `document_checkout_status_idle_release_index` ON `document_checkout` (`status`,`idle_release_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_type_name_unique_index` ON `document_type` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_type_code_unique_index` ON `document_type` (`code`);
--> statement-breakpoint
CREATE INDEX `file_matter_id_created_at_id_index` ON `file` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `file_folder_id_created_at_id_index` ON `file` (`folder_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_r2_key_unique_index` ON `file_version` (`r2_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_file_id_version_number_unique_index` ON `file_version` (`file_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `file_version_status_index` ON `file_version` (`status`);
--> statement-breakpoint
CREATE INDEX `file_version_tiering_index` ON `file_version` (`storage_class`,`status`,`committed_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_secret_name_unique` ON `firm_secret` (`name`);
--> statement-breakpoint
CREATE INDEX `folder_matter_id_created_at_id_index` ON `folder` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_matter_id_parent_folder_id_name_unique` ON `folder` (`matter_id`,`parent_folder_id`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_key_key_unique_index` ON `idempotency_key` (`key`);
--> statement-breakpoint
CREATE INDEX `idempotency_key_created_at_index` ON `idempotency_key` (`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connection_principal_category_unique_index` ON `integration_connection` (`category`,`principal_ref`);
--> statement-breakpoint
CREATE INDEX `ledger_account_parent_account_id_index` ON `ledger_account` (`parent_account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entry_reverses_entry_id_unique_index` ON `ledger_entry` (`reverses_entry_id`);
--> statement-breakpoint
CREATE INDEX `ledger_entry_effective_date_index` ON `ledger_entry` (`effective_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_line_entry_id_line_index_unique_index` ON `ledger_line` (`entry_id`,`line_index`);
--> statement-breakpoint
CREATE INDEX `ledger_line_account_id_index` ON `ledger_line` (`account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_number_code_unique_index` ON `location` (`number_code`);
--> statement-breakpoint
CREATE INDEX `location_address_location_id_index` ON `location_address` (`location_id`);
--> statement-breakpoint
CREATE INDEX `matter_party_matter_id_index` ON `matter_party` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `matter_party_entity_id_index` ON `matter_party` (`entity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_type_name_unique_index` ON `matter_type` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_type_code_unique_index` ON `matter_type` (`code`);
--> statement-breakpoint
CREATE INDEX `member_location_location_id_index` ON `member_location` (`location_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_location_member_user_id_location_id_unique` ON `member_location` (`member_user_id`,`location_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_role_member_user_id_role_id_unique` ON `member_role` (`member_user_id`,`role_id`);
--> statement-breakpoint
CREATE INDEX `narrative_template_utbms_task_code_index` ON `narrative_template` (`utbms_task_code_id`);
--> statement-breakpoint
CREATE INDEX `outbox_status_created_at_index` ON `outbox` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `picklist_option_field_id_index` ON `picklist_option` (`field_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_open_row_unique_index` ON `rate` (`rate_card_id`,`tier`,`scoped_id`) WHERE "rate"."valid_to" IS NULL;
--> statement-breakpoint
CREATE INDEX `rate_resolution_index` ON `rate` (`rate_card_id`,`tier`,`scoped_id`,`valid_from`);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_name_unique` ON `role` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permission_role_id_permission_unique` ON `role_permission` (`role_id`,`permission`);
--> statement-breakpoint
CREATE INDEX `shipment_matter_ref_index` ON `shipment` (`matter_ref`);
--> statement-breakpoint
CREATE INDEX `shipment_tracking_code_index` ON `shipment` (`tracking_code`);
--> statement-breakpoint
CREATE INDEX `time_entry_timekeeper_work_date_index` ON `time_entry` (`timekeeper_user_id`,`work_date`);
--> statement-breakpoint
CREATE INDEX `time_entry_matter_status_index` ON `time_entry` (`matter_id`,`status`);
--> statement-breakpoint
CREATE INDEX `time_entry_status_work_date_index` ON `time_entry` (`status`,`work_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_live_run_id_unique_index` ON `time_entry` (`live_run_id`) WHERE "time_entry"."live_run_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_event_shipment_remote_unique_index` ON `tracking_event` (`shipment_ref`,`remote_id`);
--> statement-breakpoint
CREATE INDEX `upload_session_status_expires_at_index` ON `upload_session` (`status`,`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `utbms_code_code_set_code_unique` ON `utbms_code` (`code_set`,`code`);
--> statement-breakpoint
CREATE INDEX `file_repair_provenance_version_index` ON `file_repair_provenance` (`file_version_id`);
--> statement-breakpoint
CREATE INDEX `conflicts_hit_check_id_index` ON `conflicts_hit` (`check_id`);
--> statement-breakpoint
CREATE INDEX `conflicts_disposition_hit_id_created_at_index` ON `conflicts_disposition` (`hit_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `directory_email_normalized_address_index` ON `directory_email` (`normalized_address`);
--> statement-breakpoint
CREATE INDEX `email_thread_subject_normalized_index` ON `email_thread` (`subject_normalized`);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_dedup_key_unique_index` ON `email_message` (`dedup_key`);
--> statement-breakpoint
CREATE INDEX `email_message_thread_id_index` ON `email_message` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `email_message_message_id_value_index` ON `email_message` (`message_id_value`);
--> statement-breakpoint
CREATE INDEX `email_message_content_sha256_index` ON `email_message` (`content_sha256`);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_matter_link_message_matter_unique_index` ON `email_matter_link` (`email_message_id`,`matter_id`);
--> statement-breakpoint
CREATE INDEX `email_matter_link_matter_created_id_index` ON `email_matter_link` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `email_matter_link_email_message_id_index` ON `email_matter_link` (`email_message_id`);
--> statement-breakpoint
CREATE INDEX `email_participant_email_message_id_index` ON `email_participant` (`email_message_id`);
--> statement-breakpoint
CREATE INDEX `email_participant_directory_entity_id_index` ON `email_participant` (`directory_entity_id`);
--> statement-breakpoint
CREATE INDEX `email_attachment_email_message_id_index` ON `email_attachment` (`email_message_id`);
--> statement-breakpoint
CREATE INDEX `email_attachment_file_id_index` ON `email_attachment` (`file_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_capture_address_token_unique_index` ON `email_capture_address` (`token`);
--> statement-breakpoint
CREATE INDEX `email_capture_address_matter_id_index` ON `email_capture_address` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `index_split_matter_superseded_index` ON `index_split` (`matter_id`,`superseded_at`);
--> statement-breakpoint
CREATE INDEX `matter_number_allocation_matter_id_index` ON `matter_number_allocation` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `index_split_document_index` ON `index_split` (`document_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_split_document_version_unique` ON `index_split` (`document_id`,`version`) WHERE "index_split"."document_id" IS NOT NULL AND "index_split"."superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX `document_template_status_name_index` ON `document_template` (`status`,`name`);
--> statement-breakpoint
CREATE INDEX `document_template_matter_type_id_index` ON `document_template` (`matter_type_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_version_r2_key_unique_index` ON `document_template_version` (`r2_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_version_template_version_number_unique_index` ON `document_template_version` (`template_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `document_template_version_template_id_created_at_id_index` ON `document_template_version` (`template_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `document_assembly_matter_id_created_at_id_index` ON `document_assembly` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `document_assembly_template_version_id_index` ON `document_assembly` (`template_version_id`);
--> statement-breakpoint
CREATE INDEX `custody_location_parent_index` ON `custody_location` (`parent_location_id`);
--> statement-breakpoint
CREATE INDEX `custody_location_firm_location_index` ON `custody_location` (`firm_location_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_item_type_name_unique_index` ON `custody_item_type` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_item_type_code_unique_index` ON `custody_item_type` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_packet_custody_number_unique_index` ON `custody_packet` (`custody_number`);
--> statement-breakpoint
CREATE INDEX `custody_packet_status_number_index` ON `custody_packet` (`status`,`custody_number`);
--> statement-breakpoint
CREATE INDEX `custody_packet_current_location_index` ON `custody_packet` (`current_location_id`);
--> statement-breakpoint
CREATE INDEX `custody_packet_matter_index` ON `custody_packet` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `custody_packet_depositor_index` ON `custody_packet` (`depositor_entity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_item_packet_ordinal_unique_index` ON `custody_item` (`packet_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `custody_item_item_type_index` ON `custody_item` (`item_type_id`);
--> statement-breakpoint
CREATE INDEX `custody_owner_packet_index` ON `custody_owner` (`packet_id`);
--> statement-breakpoint
CREATE INDEX `custody_owner_entity_index` ON `custody_owner` (`entity_id`,`effective_to`);
--> statement-breakpoint
CREATE INDEX `custody_hold_packet_released_index` ON `custody_hold` (`packet_id`,`released_at`);
--> statement-breakpoint
CREATE INDEX `custody_hold_item_index` ON `custody_hold` (`item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_scan_file_unique_index` ON `custody_scan` (`file_id`);
--> statement-breakpoint
CREATE INDEX `custody_scan_packet_index` ON `custody_scan` (`packet_id`);
--> statement-breakpoint
CREATE INDEX `custody_scan_item_index` ON `custody_scan` (`item_id`);
--> statement-breakpoint
CREATE INDEX `custody_destruction_request_packet_index` ON `custody_destruction_request` (`packet_id`);
--> statement-breakpoint
CREATE INDEX `custody_number_allocation_packet_index` ON `custody_number_allocation` (`packet_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_template_field_mapping_field_name_unique_index` ON `document_template_field_mapping` (`field_name`);
--> statement-breakpoint
CREATE INDEX `custody_packet_review_index` ON `custody_packet` (`review_on`) WHERE `review_on` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `custody_item_review_index` ON `custody_item` (`review_on`) WHERE `review_on` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `custody_movement_packet_occurred_index` ON `custody_movement` (`packet_id`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `custody_movement_borrower_entity_index` ON `custody_movement` (`borrower_entity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_account_bank_ledger_account_unique_index` ON `trust_account` (`bank_ledger_account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_account_client_liability_account_unique_index` ON `trust_account` (`client_liability_account_id`);
--> statement-breakpoint
CREATE INDEX `trust_account_location_index` ON `trust_account` (`location_id`);
--> statement-breakpoint
CREATE INDEX `trust_account_status_index` ON `trust_account` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_ledger_account_unique_index` ON `trust_ledger_node` (`ledger_account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_client_unique_index` ON `trust_ledger_node` (`trust_account_id`,`client_entity_id`) WHERE `kind` = 'client';
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_matter_unique_index` ON `trust_ledger_node` (`trust_account_id`,`matter_id`) WHERE `kind` = 'matter';
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_ledger_node_firm_funds_unique_index` ON `trust_ledger_node` (`trust_account_id`) WHERE `kind` = 'firm_funds';
--> statement-breakpoint
CREATE INDEX `trust_ledger_node_account_kind_index` ON `trust_ledger_node` (`trust_account_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `trust_ledger_node_matter_index` ON `trust_ledger_node` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `trust_ledger_node_parent_index` ON `trust_ledger_node` (`parent_node_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_hold_releases_hold_unique_index` ON `trust_hold` (`releases_hold_id`);
--> statement-breakpoint
CREATE INDEX `trust_hold_node_active_index` ON `trust_hold` (`node_id`) WHERE `releases_hold_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_transfer_trust_entry_unique_index` ON `trust_transfer` (`trust_entry_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_transfer_operating_entry_unique_index` ON `trust_transfer` (`operating_entry_id`);
--> statement-breakpoint
CREATE INDEX `trust_transfer_from_node_index` ON `trust_transfer` (`from_node_id`);
--> statement-breakpoint
CREATE INDEX `trust_transfer_account_effective_date_index` ON `trust_transfer` (`trust_account_id`,`effective_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_movement_entry_unique_index` ON `trust_movement` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `trust_movement_node_effective_date_index` ON `trust_movement` (`node_id`,`effective_date`);
--> statement-breakpoint
CREATE INDEX `trust_movement_counterparty_node_index` ON `trust_movement` (`counterparty_node_id`);
--> statement-breakpoint
CREATE INDEX `trust_movement_account_effective_date_index` ON `trust_movement` (`trust_account_id`,`effective_date`);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_status_opened_index` ON `custody_stocktake` (`status`,`opened_at`);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_scope_index` ON `custody_stocktake` (`scope_location_id`);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_sighting_stocktake_index` ON `custody_stocktake_sighting` (`stocktake_id`,`observed_at`);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_sighting_packet_index` ON `custody_stocktake_sighting` (`packet_id`);
--> statement-breakpoint
CREATE INDEX `custody_stocktake_sighting_location_index` ON `custody_stocktake_sighting` (`location_id`);
--> statement-breakpoint
CREATE INDEX `email_matter_link_linked_by_created_index` ON `email_matter_link` (`linked_by`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `trust_disbursement_request_account_requested_at_index` ON `trust_disbursement_request` (`trust_account_id`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `trust_disbursement_request_node_index` ON `trust_disbursement_request` (`node_id`);
--> statement-breakpoint
CREATE INDEX `custody_destruction_request_outcome_index` ON `custody_destruction_request` (`outcome`,`requested_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_bank_statement_supersedes_unique_index` ON `trust_bank_statement` (`supersedes_statement_id`);
--> statement-breakpoint
CREATE INDEX `trust_bank_statement_account_period_index` ON `trust_bank_statement` (`trust_account_id`,`period_end`);
--> statement-breakpoint
CREATE INDEX `trust_bank_statement_line_statement_posted_index` ON `trust_bank_statement_line` (`statement_id`,`posted_on`);
--> statement-breakpoint
CREATE INDEX `trust_bank_statement_line_amount_index` ON `trust_bank_statement_line` (`amount_minor`,`statement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_reconciliation_supersedes_unique_index` ON `trust_reconciliation` (`supersedes_reconciliation_id`);
--> statement-breakpoint
CREATE INDEX `trust_reconciliation_account_opened_index` ON `trust_reconciliation` (`trust_account_id`,`opened_at`);
--> statement-breakpoint
CREATE INDEX `trust_reconciliation_statement_index` ON `trust_reconciliation` (`statement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_reconciliation_match_unmatches_unique_index` ON `trust_reconciliation_match` (`unmatches_match_id`);
--> statement-breakpoint
CREATE INDEX `trust_reconciliation_match_reconciliation_index` ON `trust_reconciliation_match` (`reconciliation_id`);
--> statement-breakpoint
CREATE INDEX `trust_reconciliation_match_line_index` ON `trust_reconciliation_match` (`statement_line_id`);
--> statement-breakpoint
CREATE INDEX `trust_reconciliation_match_entry_index` ON `trust_reconciliation_match` (`entry_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_auto_file_rule_kind_match_matter_unique_index` ON `email_auto_file_rule` (`kind`,`match_value`,`matter_id`);
--> statement-breakpoint
CREATE INDEX `email_auto_file_rule_kind_match_index` ON `email_auto_file_rule` (`kind`,`match_value`);
--> statement-breakpoint
CREATE INDEX `email_auto_file_rule_matter_id_index` ON `email_auto_file_rule` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `email_auto_file_rule_state_index` ON `email_auto_file_rule` (`state`) WHERE "email_auto_file_rule"."state" != 'active';
--> statement-breakpoint
CREATE INDEX `email_auto_file_decision_rule_created_index` ON `email_auto_file_decision` (`auto_file_rule_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `email_auto_file_decision_email_message_id_index` ON `email_auto_file_decision` (`email_message_id`);
--> statement-breakpoint
CREATE INDEX `invoice_client_status_index` ON `invoice` (`client_entity_id`,`status`);
--> statement-breakpoint
CREATE INDEX `invoice_status_due_date_index` ON `invoice` (`status`,`due_date`);
--> statement-breakpoint
CREATE INDEX `invoice_created_at_id_index` ON `invoice` (`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_unique_index` ON `invoice` (`invoice_number`) WHERE `invoice_number` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_line_position_unique_index` ON `invoice_line` (`invoice_id`,`line_index`);
--> statement-breakpoint
CREATE INDEX `invoice_line_matter_index` ON `invoice_line` (`matter_id`,`invoice_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_wip_claim_active_source_unique_index` ON `invoice_wip_claim` (`source_kind`,`source_id`) WHERE `released_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `invoice_wip_claim_invoice_index` ON `invoice_wip_claim` (`invoice_id`);
--> statement-breakpoint
CREATE INDEX `invoice_wip_claim_line_index` ON `invoice_wip_claim` (`invoice_line_id`);
--> statement-breakpoint
CREATE INDEX `invoice_matter_balance_matter_index` ON `invoice_matter_balance` (`matter_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_allocation_invoice_unique_index` ON `invoice_number_allocation` (`invoice_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_event_type_name_unique_index` ON `matter_event_type` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_event_type_code_unique_index` ON `matter_event_type` (`code`);
--> statement-breakpoint
CREATE INDEX `matter_event_matter_starts_on_id_index` ON `matter_event` (`matter_id`,`starts_on`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_event_starts_on_id_index` ON `matter_event` (`starts_on`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_event_status_starts_on_index` ON `matter_event` (`status`,`starts_on`);
--> statement-breakpoint
CREATE INDEX `matter_event_type_index` ON `matter_event` (`event_type_id`);
--> statement-breakpoint
CREATE INDEX `matter_event_participant_event_index` ON `matter_event_participant` (`event_id`);
--> statement-breakpoint
CREATE INDEX `matter_event_participant_entity_index` ON `matter_event_participant` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `matter_deadline_state_due_on_id_index` ON `matter_deadline` (`state`,`due_on`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_deadline_matter_due_on_id_index` ON `matter_deadline` (`matter_id`,`due_on`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_deadline_trigger_event_index` ON `matter_deadline` (`trigger_event_id`);
--> statement-breakpoint
CREATE INDEX `audit_log_subject_created_id_index` ON `audit_log` (`subject_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `conflicts_check_subject_matter_created_id_index` ON `conflicts_check` (`subject_matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `document_template_field_binding_merge_key_index` ON `document_template_field_binding` (`merge_key`,`template_version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_asset_type_name_unique_index` ON `matter_asset_type` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_asset_type_code_unique_index` ON `matter_asset_type` (`code`);
--> statement-breakpoint
CREATE INDEX `matter_asset_type_class_position_index` ON `matter_asset_type` (`class`,`position`);
--> statement-breakpoint
CREATE INDEX `matter_asset_matter_class_created_id_index` ON `matter_asset` (`matter_id`,`class`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_type_index` ON `matter_asset` (`asset_type_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_real_property_parcel_index` ON `matter_asset_real_property` (`parcel_number`);
--> statement-breakpoint
CREATE INDEX `matter_asset_real_property_region_city_index` ON `matter_asset_real_property` (`region`,`city`);
--> statement-breakpoint
CREATE INDEX `matter_asset_financial_account_institution_index` ON `matter_asset_financial_account` (`institution_organization_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_valuation_asset_as_of_index` ON `matter_asset_valuation` (`asset_id`,`as_of_date`,`recorded_at`);
--> statement-breakpoint
CREATE INDEX `matter_asset_valuation_corrects_index` ON `matter_asset_valuation` (`corrects_valuation_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_interest_asset_index` ON `matter_asset_interest` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_interest_entity_index` ON `matter_asset_interest` (`entity_id`,`effective_to`);
--> statement-breakpoint
CREATE INDEX `matter_asset_document_asset_index` ON `matter_asset_document` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_document_file_index` ON `matter_asset_document` (`file_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_identifier_asset_index` ON `matter_asset_identifier` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `magnus_conversation_created_by_index` ON `magnus_conversation` (`created_by`,`created_at`);
--> statement-breakpoint
CREATE INDEX `magnus_conversation_matter_index` ON `magnus_conversation` (`matter_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `magnus_turn_conversation_sequence_unique` ON `magnus_turn` (`conversation_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `magnus_turn_created_at_index` ON `magnus_turn` (`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_application_reverses_unique_index` ON `invoice_application` (`reverses_application_id`);
--> statement-breakpoint
CREATE INDEX `invoice_application_invoice_matter_index` ON `invoice_application` (`invoice_id`,`matter_id`);
--> statement-breakpoint
CREATE INDEX `invoice_application_matter_index` ON `invoice_application` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `invoice_application_trust_transfer_index` ON `invoice_application` (`trust_transfer_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_business_interest_organization_index` ON `matter_asset_business_interest` (`entity_organization_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_encumbrance_asset_released_index` ON `matter_asset_encumbrance` (`asset_id`,`released_on`);
--> statement-breakpoint
CREATE INDEX `matter_asset_encumbrance_holder_index` ON `matter_asset_encumbrance` (`holder_entity_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_firearm_serial_index` ON `matter_asset_firearm` (`serial_number`);
--> statement-breakpoint
CREATE INDEX `matter_asset_insurance_policy_carrier_index` ON `matter_asset_insurance_policy` (`carrier_organization_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_insurance_policy_insured_index` ON `matter_asset_insurance_policy` (`insured_entity_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_receivable_debtor_index` ON `matter_asset_receivable` (`debtor_entity_id`);
--> statement-breakpoint
CREATE INDEX `matter_asset_vehicle_identification_number_index` ON `matter_asset_vehicle` (`vehicle_identification_number`);
--> statement-breakpoint
CREATE INDEX `matter_asset_vehicle_plate_index` ON `matter_asset_vehicle` (`plate_number`);
--> statement-breakpoint
CREATE INDEX `matter_asset_valuation_encumbrance_as_of_index` ON `matter_asset_valuation` (`encumbrance_id`,`as_of_date`,`recorded_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_set_matter_name_unique_index` ON `review_set` (`matter_id`,`name`);
--> statement-breakpoint
CREATE INDEX `review_set_matter_created_index` ON `review_set` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_custodian_review_set_name_unique_index` ON `record_custodian` (`review_set_id`,`display_name`);
--> statement-breakpoint
CREATE INDEX `record_custodian_directory_entity_index` ON `record_custodian` (`directory_entity_id`);
--> statement-breakpoint
CREATE INDEX `discovery_load_review_set_initiated_index` ON `discovery_load` (`review_set_id`,`initiated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `discovery_load_review_set_state_index` ON `discovery_load` (`review_set_id`,`state`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_sort_index` ON `review_document` (`review_set_id`,`sort_date`,`id`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_load_index` ON `review_document` (`review_set_id`,`discovery_load_id`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_record_custodian_index` ON `review_document` (`review_set_id`,`record_custodian_id`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_state_index` ON `review_document` (`review_set_id`,`processing_state`);
--> statement-breakpoint
CREATE INDEX `review_document_family_index` ON `review_document` (`review_set_id`,`family_id`,`family_sequence`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_dedup_index` ON `review_document` (`review_set_id`,`dedup_group_id`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_sha256_index` ON `review_document` (`review_set_id`,`content_sha256`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_review_set_file_version_unique_index` ON `review_document` (`review_set_id`,`file_version_id`) WHERE `file_version_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_review_set_email_message_unique_index` ON `review_document` (`review_set_id`,`email_message_id`) WHERE `email_message_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `review_document_exception_review_set_code_index` ON `review_document_exception` (`review_set_id`,`code`);
--> statement-breakpoint
CREATE INDEX `review_document_exception_document_index` ON `review_document_exception` (`review_document_id`);
--> statement-breakpoint
CREATE INDEX `review_document_occurrence_primary_index` ON `review_document_occurrence` (`review_set_id`,`primary_review_document_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_occurrence_duplicate_unique_index` ON `review_document_occurrence` (`duplicate_review_document_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_recipient_event_user_unique_index` ON `notification_recipient` (`notification_event_id`,`recipient_user_id`);
--> statement-breakpoint
CREATE INDEX `notification_recipient_user_state_created_index` ON `notification_recipient` (`recipient_user_id`,`state`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `notification_recipient_user_created_index` ON `notification_recipient` (`recipient_user_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_recipient_channel_unique_index` ON `notification_delivery` (`notification_recipient_id`,`channel`);
--> statement-breakpoint
CREATE INDEX `notification_delivery_state_index` ON `notification_delivery` (`state`,`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_digest_run_user_cadence_unique_index` ON `notification_digest_run` (`recipient_user_id`,`cadence`);
--> statement-breakpoint
CREATE INDEX `matter_assignment_matter_id_index` ON `matter_assignment` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `matter_assignment_member_user_id_index` ON `matter_assignment` (`member_user_id`);
--> statement-breakpoint
CREATE INDEX `directory_person_member_id_index` ON `directory_person` (`member_id`) WHERE "directory_person"."member_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_court_case_matter_id_unique_index` ON `matter_court_case` (`matter_id`) WHERE "matter_court_case"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_estate_matter_id_unique_index` ON `matter_estate` (`matter_id`) WHERE "matter_estate"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_authorization_policy_version_unique_index` ON `trust_authorization_policy` (`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_disbursement_decision_request_unique_index` ON `trust_disbursement_decision` (`request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_disbursement_decision_movement_unique_index` ON `trust_disbursement_decision` (`movement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_disbursement_decision_transfer_unique_index` ON `trust_disbursement_decision` (`transfer_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_transfer_approved_request_unique_index` ON `trust_transfer` (`approved_request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_trust_application_line_request_invoice_unique_index` ON `invoice_trust_application_line` (`request_id`,`invoice_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_billing_arrangement_version_unique_index` ON `matter_billing_arrangement` (`matter_id`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_billing_arrangement_open_unique_index` ON `matter_billing_arrangement` (`matter_id`) WHERE `valid_to` IS NULL;
--> statement-breakpoint
CREATE INDEX `matter_recovery_matter_index` ON `matter_recovery` (`matter_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `retainer_replenishment_request_open_unique_index` ON `retainer_replenishment_request` (`matter_id`) WHERE `resolved_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `retainer_replenishment_request_matter_index` ON `retainer_replenishment_request` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `firm_event_starts_on_id_index` ON `firm_event` (`starts_on`,`id`);
--> statement-breakpoint
CREATE INDEX `firm_event_status_starts_on_index` ON `firm_event` (`status`,`starts_on`);
--> statement-breakpoint
CREATE INDEX `firm_event_location_index` ON `firm_event` (`location_id`);
--> statement-breakpoint
CREATE INDEX `firm_event_participant_event_index` ON `firm_event_participant` (`firm_event_id`);
--> statement-breakpoint
CREATE INDEX `firm_event_participant_member_index` ON `firm_event_participant` (`member_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_resource_name_unique_index` ON `firm_resource` (`name`);
--> statement-breakpoint
CREATE INDEX `firm_resource_booking_resource_starts_index` ON `firm_resource_booking` (`resource_id`,`starts_on`,`id`);
--> statement-breakpoint
CREATE INDEX `firm_resource_booking_matter_event_index` ON `firm_resource_booking` (`matter_event_id`);
--> statement-breakpoint
CREATE INDEX `firm_resource_booking_firm_event_index` ON `firm_resource_booking` (`firm_event_id`);
--> statement-breakpoint
CREATE INDEX `calendar_event_link_from_matter_index` ON `calendar_event_link` (`from_matter_event_id`);
--> statement-breakpoint
CREATE INDEX `calendar_event_link_from_firm_index` ON `calendar_event_link` (`from_firm_event_id`);
--> statement-breakpoint
CREATE INDEX `calendar_event_link_to_matter_index` ON `calendar_event_link` (`to_matter_event_id`);
--> statement-breakpoint
CREATE INDEX `calendar_event_link_to_firm_index` ON `calendar_event_link` (`to_firm_event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_link_continuance_from_unique` ON `calendar_event_link` (`from_matter_event_id`) WHERE `kind` = 'continuance_of';
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_link_continuance_to_unique` ON `calendar_event_link` (`to_matter_event_id`) WHERE `kind` = 'continuance_of';
--> statement-breakpoint
CREATE UNIQUE INDEX `review_set_access_member_unique_index` ON `review_set_access` (`review_set_id`,`member_user_id`);
--> statement-breakpoint
CREATE INDEX `review_set_access_member_index` ON `review_set_access` (`member_user_id`,`review_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_tag_group_review_set_name_unique_index` ON `review_tag_group` (`review_set_id`,`name`);
--> statement-breakpoint
CREATE INDEX `review_tag_group_review_set_order_index` ON `review_tag_group` (`review_set_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_tag_group_name_unique_index` ON `review_tag` (`review_tag_group_id`,`name`);
--> statement-breakpoint
CREATE INDEX `review_tag_review_set_index` ON `review_tag` (`review_set_id`,`review_tag_group_id`);
--> statement-breakpoint
CREATE INDEX `review_tag_event_review_set_created_index` ON `review_tag_event` (`review_set_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `review_tag_event_review_set_actor_index` ON `review_tag_event` (`review_set_id`,`actor_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_tag_event_reverses_unique_index` ON `review_tag_event` (`reverses_event_id`) WHERE "review_tag_event"."reverses_event_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_tag_single_choice_unique_index` ON `review_document_tag` (`review_document_id`,`review_tag_group_id`) WHERE "review_document_tag"."removed_at" IS NULL AND "review_document_tag"."single_choice" = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_tag_live_unique_index` ON `review_document_tag` (`review_document_id`,`review_tag_id`) WHERE "review_document_tag"."removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX `review_document_tag_document_index` ON `review_document_tag` (`review_document_id`,`removed_at`);
--> statement-breakpoint
CREATE INDEX `review_document_tag_review_set_tag_index` ON `review_document_tag` (`review_set_id`,`review_tag_id`,`removed_at`);
--> statement-breakpoint
CREATE INDEX `review_document_tag_applied_event_index` ON `review_document_tag` (`applied_by_event_id`);
--> statement-breakpoint
CREATE INDEX `review_document_tag_removed_event_index` ON `review_document_tag` (`removed_by_event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_firm_funds_movement_entry_unique_index` ON `trust_firm_funds_movement` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `trust_firm_funds_movement_account_effective_date_index` ON `trust_firm_funds_movement` (`trust_account_id`,`effective_date`);
--> statement-breakpoint
CREATE INDEX `trust_unclaimed_funds_contact_attempt_review_index` ON `trust_unclaimed_funds_contact_attempt` (`review_id`,`attempted_on`);
--> statement-breakpoint
CREATE INDEX `trust_unclaimed_funds_review_account_index` ON `trust_unclaimed_funds_review` (`trust_account_id`,`opened_at`);
--> statement-breakpoint
CREATE INDEX `trust_unclaimed_funds_review_node_index` ON `trust_unclaimed_funds_review` (`node_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_unclaimed_funds_review_closure_review_unique_index` ON `trust_unclaimed_funds_review_closure` (`review_id`);
--> statement-breakpoint
CREATE INDEX `credit_note_invoice_index` ON `credit_note` (`invoice_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_entry_unique_index` ON `credit_note` (`entry_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_line_index_unique_index` ON `credit_note_line` (`credit_note_id`,`line_index`);
--> statement-breakpoint
CREATE INDEX `credit_note_line_matter_index` ON `credit_note_line` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `credit_note_line_credits_index` ON `credit_note_line` (`credits_invoice_line_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_credit_note_matter_unique_index` ON `client_credit` (`credit_note_id`,`matter_id`);
--> statement-breakpoint
CREATE INDEX `client_credit_client_index` ON `client_credit` (`client_entity_id`);
--> statement-breakpoint
CREATE INDEX `client_credit_matter_index` ON `client_credit` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `invoice_application_credit_note_index` ON `invoice_application` (`credit_note_id`);
--> statement-breakpoint
CREATE INDEX `invoice_application_client_credit_index` ON `invoice_application` (`client_credit_id`);
--> statement-breakpoint
CREATE INDEX `index_split_member_split_superseded_index` ON `index_split_member` (`split_id`,`superseded_at`);
--> statement-breakpoint
CREATE INDEX `index_split_member_document_index` ON `index_split_member` (`document_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflicts_recheck_request_open_cause_unique` ON `conflicts_recheck_request` (`matter_id`,`cause_topic`,`cause_reference`) WHERE `satisfied_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `conflicts_recheck_request_satisfied_requested_index` ON `conflicts_recheck_request` (`satisfied_at`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `conflicts_recheck_request_matter_satisfied_index` ON `conflicts_recheck_request` (`matter_id`,`satisfied_at`);
--> statement-breakpoint
CREATE INDEX `matter_event_participant_member_event_index` ON `matter_event_participant` (`member_user_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `custody_packet_created_index` ON `custody_packet` (`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `custody_movement_occurred_index` ON `custody_movement` (`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `review_document_load_state_index` ON `review_document` (`discovery_load_id`,`processing_state`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_document_dedup_primary_unique_index` ON `review_document` (`review_set_id`,`dedup_group_id`) WHERE `dedup_group_id` IS NOT NULL AND `is_dedup_primary` = 1;
--> statement-breakpoint
CREATE INDEX `review_document_exception_load_index` ON `review_document_exception` (`discovery_load_id`,`review_document_id`);
--> statement-breakpoint
CREATE INDEX `ai_search_feed_object_matter_id_index` ON `ai_search_feed_object` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `ai_search_feed_object_fed_at_index` ON `ai_search_feed_object` (`fed_at`);
--> statement-breakpoint
CREATE INDEX `directory_name_normalized_match_key_index` ON `directory_name` (`normalized_match_key`);
--> statement-breakpoint
CREATE INDEX `directory_name_normalized_match_key_bare_index` ON `directory_name` (`normalized_match_key_bare`);
--> statement-breakpoint
CREATE INDEX `nickname_equivalence_equivalent_form_index` ON `nickname_equivalence` (`equivalent_form`);
--> statement-breakpoint
CREATE INDEX `invoice_delivery_invoice_index` ON `invoice_delivery` (`invoice_id`);
--> statement-breakpoint
CREATE INDEX `invoice_delivery_date_index` ON `invoice_delivery` (`delivery_date`);
--> statement-breakpoint
CREATE INDEX `index_split_corpus_superseded_index` ON `index_split` (`corpus_id`,`superseded_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `review_document_index_state_index` ON `review_document` (`review_set_id`,`index_state`);
--> statement-breakpoint
CREATE INDEX `review_document_review_set_page_index` ON `review_document` (`review_set_id`,`sort_date`,`id`,`processing_state`);
--> statement-breakpoint
CREATE INDEX `review_document_custodian_page_index` ON `review_document` (`review_set_id`,`record_custodian_id`,`sort_date`,`id`);
--> statement-breakpoint
CREATE INDEX `review_document_load_page_index` ON `review_document` (`review_set_id`,`discovery_load_id`,`sort_date`,`id`);
--> statement-breakpoint
CREATE INDEX `review_document_state_page_index` ON `review_document` (`review_set_id`,`processing_state`,`sort_date`,`id`);
--> statement-breakpoint
CREATE INDEX `review_document_exception_review_set_page_index` ON `review_document_exception` (`review_set_id`,`review_document_id`,`id`);
--> statement-breakpoint
CREATE INDEX `review_document_occurrence_primary_page_index` ON `review_document_occurrence` (`review_set_id`,`primary_review_document_id`,`duplicate_review_document_id`);
--> statement-breakpoint
CREATE INDEX `email_matter_link_auto_file_rule_created_index` ON `email_matter_link` (`auto_file_rule_id`,`created_at`,`id`) WHERE "email_matter_link"."auto_file_rule_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `directory_phone_national_number_index` ON `directory_phone` (`country_calling_code`,`national_number`);
--> statement-breakpoint
CREATE INDEX `directory_address_normalized_key_index` ON `directory_address` (`normalized_key`);
--> statement-breakpoint
CREATE INDEX `download_item_member_created_index` ON `download_item` (`member_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `download_item_expiry_index` ON `download_item` (`expires_at`, `state`);
--> statement-breakpoint
CREATE INDEX `matter_note_matter_created_at_id_index` ON `matter_note` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_note_matter_occurred_on_id_index` ON `matter_note` (`matter_id`,`occurred_on`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_note_created_at_id_index` ON `matter_note` (`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_note_author_index` ON `matter_note` (`author_user_id`);
--> statement-breakpoint
CREATE INDEX `matter_note_document_note_index` ON `matter_note_document` (`note_id`);
--> statement-breakpoint
CREATE INDEX `matter_note_document_file_index` ON `matter_note_document` (`file_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_note_document_note_file_unique_index` ON `matter_note_document` (`note_id`,`file_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_entry_number_unique_index` ON `time_entry` (`entry_number`) WHERE "time_entry"."entry_number" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `time_entry_number_allocation_time_entry_id_index` ON `time_entry_number_allocation` (`time_entry_id`);
--> statement-breakpoint
CREATE INDEX `time_entry_attachment_file_id_index` ON `time_entry_attachment` (`file_id`);
--> statement-breakpoint
CREATE INDEX `matter_task_assignee_state_due_on_index` ON `matter_task` (`assignee_user_id`,`state`,`due_on`);
--> statement-breakpoint
CREATE INDEX `matter_task_matter_due_on_id_index` ON `matter_task` (`matter_id`,`due_on`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_task_matter_created_at_id_index` ON `matter_task` (`matter_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_task_created_by_index` ON `matter_task` (`created_by`,`created_at`);
--> statement-breakpoint
CREATE INDEX `matter_task_blocked_by_index` ON `matter_task` (`blocked_by_task_id`);
--> statement-breakpoint
CREATE INDEX `matter_task_deadline_index` ON `matter_task` (`deadline_id`);
--> statement-breakpoint
CREATE INDEX `matter_task_document_task_index` ON `matter_task_document` (`task_id`);
--> statement-breakpoint
CREATE INDEX `matter_task_document_file_index` ON `matter_task_document` (`file_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_document_task_file_unique_index` ON `matter_task_document` (`task_id`,`file_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_event_dedupe_key_unique_index` ON `notification_event` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `notification_event_matter_id_index` ON `notification_event` (`matter_id`);
--> statement-breakpoint
CREATE INDEX `notification_event_occurred_at_index` ON `notification_event` (`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_plan_task_template_template_position_index` ON `matter_plan_task_template` (`template_id`,`position`);
--> statement-breakpoint
CREATE INDEX `matter_plan_task_template_blocked_by_index` ON `matter_plan_task_template` (`blocked_by_template_task_id`);
--> statement-breakpoint
CREATE INDEX `matter_plan_template_matter_type_active_index` ON `matter_plan_template` (`matter_type_id`,`active`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_plan_template_name_unique_index` ON `matter_plan_template` (`name`);
--> statement-breakpoint
CREATE INDEX `matter_task_plan_template_index` ON `matter_task` (`plan_template_id`);
--> statement-breakpoint
CREATE INDEX `time_entry_task_index` ON `time_entry` (`task_id`) WHERE "time_entry"."task_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `matter_task_deletion_deleted_at_id_index` ON `matter_task_deletion` (`deleted_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_external_link_system_external_id_unique_index` ON `matter_task_external_link` (`system`,`external_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_task_external_link_task_system_unique_index` ON `matter_task_external_link` (`task_id`,`system`);
--> statement-breakpoint
CREATE INDEX `matter_task_external_link_task_index` ON `matter_task_external_link` (`task_id`);
--> statement-breakpoint
CREATE INDEX `matter_task_updated_at_id_index` ON `matter_task` (`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX conflicts_check_created_id_index
  ON conflicts_check (created_at, id);
--> statement-breakpoint
CREATE INDEX conflicts_hit_entity_created_index
  ON conflicts_hit (entity_id, created_at);
--> statement-breakpoint
CREATE INDEX `intake_procedure_matter_type_active_index` ON `intake_procedure` (`matter_type_id`,`active`);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_procedure_name_unique_index` ON `intake_procedure` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_intake_step_record_live_unique_index` ON `matter_intake_step_record` (`matter_id`,`procedure_step_id`) WHERE "matter_intake_step_record"."superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX `matter_intake_step_record_matter_index` ON `matter_intake_step_record` (`matter_id`,`recorded_at`);
--> statement-breakpoint
CREATE INDEX `intake_procedure_step_procedure_position_index` ON `intake_procedure_step` (`procedure_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_matter_number_unique_index` ON `matter` (`matter_number`) WHERE "matter"."matter_number" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_consultation_number_unique_index` ON `matter` (`consultation_number`) WHERE "matter"."consultation_number" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_system_key_unique_index` ON `matter` (`system_key`) WHERE "matter"."system_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `matter_status_index` ON `matter` (`status`);
--> statement-breakpoint
CREATE INDEX `matter_responsible_member_id_created_at_id_index` ON `matter` (`responsible_member_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `matter_created_at_id_index` ON `matter` (`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `file_version_content_sha256_index` ON `file_version` (`content_sha256`);
--> statement-breakpoint
CREATE INDEX `time_entry_work_date_index` ON `time_entry` (`work_date`);
--> statement-breakpoint
CREATE INDEX `communication_matter_occurred_at_id_index` ON `communication` (`matter_id`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `communication_occurred_at_id_index` ON `communication` (`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `communication_counterparty_entity_id_index` ON `communication` (`counterparty_entity_id`);
--> statement-breakpoint
CREATE INDEX `communication_counterparty_number_index` ON `communication` (`counterparty_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_carrier_reference_unique_index` ON `communication` (`carrier_reference`) WHERE "communication"."carrier_reference" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `cost_entry_incurred_date_index` ON `cost_entry` (`incurred_date`);
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
CREATE TRIGGER `conflicts_check_no_update` BEFORE UPDATE ON `conflicts_check` BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_check_no_delete` BEFORE DELETE ON `conflicts_check` BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_update` BEFORE UPDATE ON `conflicts_hit` BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_delete` BEFORE DELETE ON `conflicts_hit` BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_update` BEFORE UPDATE ON `conflicts_disposition` BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_delete` BEFORE DELETE ON `conflicts_disposition` BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_check_no_replace` BEFORE INSERT ON `conflicts_check` WHEN EXISTS (SELECT 1 FROM `conflicts_check` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_replace` BEFORE INSERT ON `conflicts_hit` WHEN EXISTS (SELECT 1 FROM `conflicts_hit` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_replace` BEFORE INSERT ON `conflicts_disposition` WHEN EXISTS (SELECT 1 FROM `conflicts_disposition` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_no_update` BEFORE UPDATE ON `custody_movement` BEGIN
  SELECT RAISE(ABORT, 'custody_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_no_delete` BEFORE DELETE ON `custody_movement` BEGIN
  SELECT RAISE(ABORT, 'custody_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_no_replace` BEFORE INSERT ON `custody_movement` WHEN EXISTS (SELECT 1 FROM `custody_movement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'custody_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_hold_no_update` BEFORE UPDATE ON `trust_hold` BEGIN
  SELECT RAISE(ABORT, 'trust_hold is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_hold_no_delete` BEFORE DELETE ON `trust_hold` BEGIN
  SELECT RAISE(ABORT, 'trust_hold is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_hold_no_replace` BEFORE INSERT ON `trust_hold` WHEN EXISTS (SELECT 1 FROM `trust_hold` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_hold is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_no_update` BEFORE UPDATE ON `trust_transfer` BEGIN
  SELECT RAISE(ABORT, 'trust_transfer is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_no_delete` BEFORE DELETE ON `trust_transfer` BEGIN
  SELECT RAISE(ABORT, 'trust_transfer is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_no_replace` BEFORE INSERT ON `trust_transfer` WHEN EXISTS (SELECT 1 FROM `trust_transfer` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_transfer is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_release_gate` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` = 'released' AND (NEW.`release_authority_basis` IS NULL OR length(trim(NEW.`release_authority_basis`)) = 0 OR NEW.`release_identity_evidence` IS NULL OR length(trim(NEW.`release_identity_evidence`)) = 0 OR NEW.`release_identity_verified_by_user_id` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a custody release records the authority relied on and the identity check made before the property left');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_release_witness_distinct` BEFORE INSERT ON `custody_movement` WHEN NEW.`release_witnessed_by_user_id` IS NOT NULL AND NEW.`release_witnessed_by_user_id` = NEW.`release_identity_verified_by_user_id` BEGIN
  SELECT RAISE(ABORT, 'a witnessed custody release needs two different people');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_release_capture_scope` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` <> 'released' AND (NEW.`release_authority_basis` IS NOT NULL OR NEW.`release_identity_evidence` IS NOT NULL OR NEW.`release_identity_verified_by_user_id` IS NOT NULL OR NEW.`release_witnessed_by_user_id` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'release capture belongs only to a released movement');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_movement_no_update` BEFORE UPDATE ON `trust_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_movement_no_delete` BEFORE DELETE ON `trust_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_movement_no_replace` BEFORE INSERT ON `trust_movement` WHEN EXISTS (SELECT 1 FROM `trust_movement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_movement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_sighting_no_update` BEFORE UPDATE ON `custody_stocktake_sighting` BEGIN
  SELECT RAISE(ABORT, 'custody_stocktake_sighting is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_sighting_no_delete` BEFORE DELETE ON `custody_stocktake_sighting` BEGIN
  SELECT RAISE(ABORT, 'custody_stocktake_sighting is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_sighting_no_replace` BEFORE INSERT ON `custody_stocktake_sighting` WHEN EXISTS (SELECT 1 FROM `custody_stocktake_sighting` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'custody_stocktake_sighting is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_sighting_open_only` BEFORE INSERT ON `custody_stocktake_sighting` WHEN NOT EXISTS (SELECT 1 FROM `custody_stocktake` WHERE `id` = NEW.`stocktake_id` AND `status` = 'open') BEGIN
  SELECT RAISE(ABORT, 'a sighting can only be recorded against an open stocktake');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_request_no_update` BEFORE UPDATE ON `trust_disbursement_request` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_request is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_request_no_delete` BEFORE DELETE ON `trust_disbursement_request` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_request is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_request_no_replace` BEFORE INSERT ON `trust_disbursement_request` WHEN EXISTS (SELECT 1 FROM `trust_disbursement_request` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_request is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_two_person_insert` BEFORE INSERT ON `custody_destruction_request` WHEN NEW.`approved_by` IS NOT NULL AND (NEW.`requested_by` IS NULL OR NEW.`approved_by` = NEW.`requested_by`) BEGIN
  SELECT RAISE(ABORT, 'a custody destruction is approved by a different person from the one who requested it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_two_person_update` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`approved_by` IS NOT NULL AND (NEW.`requested_by` IS NULL OR NEW.`approved_by` = NEW.`requested_by`) BEGIN
  SELECT RAISE(ABORT, 'a custody destruction is approved by a different person from the one who requested it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_intrinsic_value` BEFORE INSERT ON `custody_destruction_request` WHEN EXISTS (SELECT 1 FROM `custody_item` WHERE `intrinsic_value` = 1 AND (`id` = NEW.`item_id` OR (NEW.`item_id` IS NULL AND `packet_id` = NEW.`packet_id`))) BEGIN
  SELECT RAISE(ABORT, 'an item of intrinsic value is never destructible');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_intrinsic_value_on_execution` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`executed_at` IS NOT NULL AND OLD.`executed_at` IS NULL AND EXISTS (SELECT 1 FROM `custody_item` WHERE `intrinsic_value` = 1 AND (`id` = NEW.`item_id` OR (NEW.`item_id` IS NULL AND `packet_id` = NEW.`packet_id`))) BEGIN
  SELECT RAISE(ABORT, 'an item of intrinsic value is never destructible');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_intrinsic_value_not_destructible` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` = 'destroyed' AND EXISTS (SELECT 1 FROM `custody_item` WHERE `intrinsic_value` = 1 AND (`id` = NEW.`item_id` OR (NEW.`item_id` IS NULL AND `packet_id` = NEW.`packet_id`))) BEGIN
  SELECT RAISE(ABORT, 'an item of intrinsic value is never destructible');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_hold_blocks_request` BEFORE INSERT ON `custody_destruction_request` WHEN EXISTS (SELECT 1 FROM `custody_hold` WHERE `packet_id` = NEW.`packet_id` AND `released_at` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a hold is in force on this packet and forbids destroying it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_hold_blocks_execution` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`executed_at` IS NOT NULL AND OLD.`executed_at` IS NULL AND EXISTS (SELECT 1 FROM `custody_hold` WHERE `packet_id` = NEW.`packet_id` AND `released_at` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a hold is in force on this packet and forbids destroying it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_execution_requires_approval` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`executed_at` IS NOT NULL AND OLD.`executed_at` IS NULL AND (OLD.`approved_by` IS NULL OR OLD.`approved_at` IS NULL OR OLD.`outcome` IS NULL OR OLD.`outcome` <> 'approved') BEGIN
  SELECT RAISE(ABORT, 'a custody destruction is carried out only after a second person has approved it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_decided_once` BEFORE UPDATE ON `custody_destruction_request` WHEN OLD.`outcome` IN ('refused', 'executed', 'withdrawn') BEGIN
  SELECT RAISE(ABORT, 'this destruction request has already been decided; raise a new one');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_line_on_statement` BEFORE INSERT ON `trust_reconciliation_match`
WHEN (SELECT `statement_id` FROM `trust_bank_statement_line` WHERE `id` = NEW.`statement_line_id`)
  <> (SELECT `statement_id` FROM `trust_reconciliation` WHERE `id` = NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation match names a line on the statement that reconciliation is about');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_entry_on_account` BEFORE INSERT ON `trust_reconciliation_match`
WHEN NOT EXISTS (
  SELECT 1 FROM `ledger_line` l
    JOIN `trust_account` a ON a.`bank_ledger_account_id` = l.`account_id`
    JOIN `trust_reconciliation` r ON r.`trust_account_id` = a.`id`
   WHERE l.`entry_id` = NEW.`entry_id` AND r.`id` = NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation match names a ledger entry that touched this trust account''s bank account');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_only_while_open` BEFORE INSERT ON `trust_reconciliation_match`
WHEN (SELECT `status` FROM `trust_reconciliation` WHERE `id` = NEW.`reconciliation_id`) <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'this reconciliation is closed; open a new one rather than changing what a closed one attested to');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_unmatch_agrees` BEFORE INSERT ON `trust_reconciliation_match`
WHEN NEW.`unmatches_match_id` IS NOT NULL
  AND (SELECT `reconciliation_id` || '|' || `statement_line_id` || '|' || `entry_id` FROM `trust_reconciliation_match` WHERE `id` = NEW.`unmatches_match_id`)
   <> (NEW.`reconciliation_id` || '|' || NEW.`statement_line_id` || '|' || NEW.`entry_id`)
BEGIN
  SELECT RAISE(ABORT, 'a withdrawal names the reconciliation, statement line, and ledger entry of the match it releases');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_unmatch_is_a_match` BEFORE INSERT ON `trust_reconciliation_match`
WHEN NEW.`unmatches_match_id` IS NOT NULL
  AND (SELECT `unmatches_match_id` FROM `trust_reconciliation_match` WHERE `id` = NEW.`unmatches_match_id`) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation match withdrawal names a match, not another withdrawal');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_no_reopen` BEFORE UPDATE ON `trust_reconciliation`
WHEN OLD.`status` <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'a closed trust reconciliation is frozen; record a new one that supersedes it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_close_only` BEFORE UPDATE ON `trust_reconciliation`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`trust_account_id` <> OLD.`trust_account_id`
  OR NEW.`statement_id` <> OLD.`statement_id`
  OR NEW.`opened_by` <> OLD.`opened_by`
  OR NEW.`opened_at` <> OLD.`opened_at`
  OR NEW.`status` <> 'closed'
  OR COALESCE(NEW.`supersedes_reconciliation_id`, '') <> COALESCE(OLD.`supersedes_reconciliation_id`, '')
BEGIN
  SELECT RAISE(ABORT, 'the only update a trust reconciliation takes is its close');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_no_delete` BEFORE DELETE ON `trust_reconciliation` BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_no_replace` BEFORE INSERT ON `trust_reconciliation` WHEN EXISTS (SELECT 1 FROM `trust_reconciliation` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_no_update` BEFORE UPDATE ON `trust_bank_statement` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_no_delete` BEFORE DELETE ON `trust_bank_statement` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_no_replace` BEFORE INSERT ON `trust_bank_statement` WHEN EXISTS (SELECT 1 FROM `trust_bank_statement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_line_no_update` BEFORE UPDATE ON `trust_bank_statement_line` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_line_no_delete` BEFORE DELETE ON `trust_bank_statement_line` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_statement_line_no_replace` BEFORE INSERT ON `trust_bank_statement_line` WHEN EXISTS (SELECT 1 FROM `trust_bank_statement_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_bank_statement_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_no_update` BEFORE UPDATE ON `trust_reconciliation_match` BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation_match is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_no_delete` BEFORE DELETE ON `trust_reconciliation_match` BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation_match is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_reconciliation_match_no_replace` BEFORE INSERT ON `trust_reconciliation_match` WHEN EXISTS (SELECT 1 FROM `trust_reconciliation_match` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_reconciliation_match is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_frozen_no_update` BEFORE UPDATE ON `invoice` WHEN OLD.`status` <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_frozen_no_delete` BEFORE DELETE ON `invoice` WHEN OLD.`status` <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_line_frozen_no_update` BEFORE UPDATE ON `invoice_line` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_line_frozen_no_delete` BEFORE DELETE ON `invoice_line` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_wip_claim_frozen_no_update` BEFORE UPDATE ON `invoice_wip_claim` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s work-in-progress claims are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_wip_claim_frozen_no_delete` BEFORE DELETE ON `invoice_wip_claim` WHEN (SELECT `status` FROM `invoice` WHERE `id` = OLD.`invoice_id`) <> 'draft' BEGIN
  SELECT RAISE(ABORT, 'a finalized or voided invoice''s work-in-progress claims are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_number_allocation_no_update` BEFORE UPDATE ON `invoice_number_allocation` BEGIN
  SELECT RAISE(ABORT, 'invoice_number_allocation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_number_allocation_no_delete` BEFORE DELETE ON `invoice_number_allocation` BEGIN
  SELECT RAISE(ABORT, 'invoice_number_allocation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_number_allocation_no_replace` BEFORE INSERT ON `invoice_number_allocation` WHEN EXISTS (SELECT 1 FROM `invoice_number_allocation` WHERE `scope_key` = NEW.`scope_key` AND `drawn_value` = NEW.`drawn_value`) BEGIN
  SELECT RAISE(ABORT, 'invoice_number_allocation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_asset_valuation_no_update` BEFORE UPDATE ON `matter_asset_valuation` BEGIN
  SELECT RAISE(ABORT, 'matter_asset_valuation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_asset_valuation_no_delete` BEFORE DELETE ON `matter_asset_valuation` BEGIN
  SELECT RAISE(ABORT, 'matter_asset_valuation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_asset_valuation_no_replace` BEFORE INSERT ON `matter_asset_valuation` WHEN EXISTS (SELECT 1 FROM `matter_asset_valuation` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_asset_valuation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_release_verifier_is_recorder` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` = 'released' AND (NEW.`recorded_by_user_id` IS NULL OR NEW.`release_identity_verified_by_user_id` <> NEW.`recorded_by_user_id`) BEGIN
  SELECT RAISE(ABORT, 'the member who checked identity on a release is the member recording it, and cannot be named on their behalf');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_movement_release_witness_is_active_member` BEFORE INSERT ON `custody_movement` WHEN NEW.`release_witnessed_by_user_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `member` WHERE `user_id` = NEW.`release_witnessed_by_user_id` AND `status` = 'active') BEGIN
  SELECT RAISE(ABORT, 'the witness on a custody release must be an active member of this firm');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_frozen_once_closed` BEFORE UPDATE ON `custody_stocktake` WHEN OLD.`status` <> 'open' BEGIN
  SELECT RAISE(ABORT, 'a closed or abandoned custody stocktake is frozen');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_stocktake_no_replace` BEFORE INSERT ON `custody_stocktake` WHEN EXISTS (SELECT 1 FROM `custody_stocktake` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'a custody stocktake row is replaced by no write path; close it or abandon it');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_no_update` BEFORE UPDATE ON `invoice_application` BEGIN
  SELECT RAISE(ABORT, 'invoice_application is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_no_delete` BEFORE DELETE ON `invoice_application` BEGIN
  SELECT RAISE(ABORT, 'invoice_application is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_no_replace` BEFORE INSERT ON `invoice_application` WHEN EXISTS (SELECT 1 FROM `invoice_application` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'invoice_application is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `review_set_state_forward_only`
BEFORE UPDATE OF `state` ON `review_set`
FOR EACH ROW WHEN OLD.`state` <> NEW.`state` AND NOT (
	(OLD.`state` = 'open' AND NEW.`state` IN ('locked', 'closed'))
	OR (OLD.`state` = 'locked' AND NEW.`state` = 'closed')
)
BEGIN
	SELECT RAISE(ABORT, 'a review set moves open -> locked -> closed and never back');
END;
--> statement-breakpoint
CREATE TRIGGER `discovery_load_state_forward_only`
BEFORE UPDATE OF `state` ON `discovery_load`
FOR EACH ROW WHEN OLD.`state` <> NEW.`state` AND NOT (
	(OLD.`state` = 'declared' AND NEW.`state` IN ('loading', 'failed'))
	OR (OLD.`state` = 'loading' AND NEW.`state` IN ('processing', 'failed'))
	OR (OLD.`state` = 'processing' AND NEW.`state` IN ('complete', 'failed'))
	OR (OLD.`state` = 'complete' AND NEW.`state` = 'reversed')
)
BEGIN
	SELECT RAISE(ABORT, 'a load moves declared -> loading -> processing -> complete, fails before it completes, and is reversed only once complete');
END;
--> statement-breakpoint
CREATE TRIGGER `review_document_terminal_state_guard`
BEFORE UPDATE OF `processing_state` ON `review_document`
FOR EACH ROW WHEN OLD.`processing_state` IN ('processed', 'excepted')
	AND NEW.`processing_state` <> OLD.`processing_state`
	AND NEW.`processing_state` <> 'pending'
BEGIN
	SELECT RAISE(ABORT, 'a document leaves a terminal processing state only by being reset to pending for a recorded re-processing');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_authorization_policy_version_dense` BEFORE INSERT ON `trust_authorization_policy`
WHEN NEW.`version` <> (SELECT COALESCE(MAX(`version`), 0) + 1 FROM `trust_authorization_policy`)
BEGIN
  SELECT RAISE(ABORT, 'a trust authorization policy version must be the next version; re-read the current policy and change it again');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_authorization_policy_no_update` BEFORE UPDATE ON `trust_authorization_policy` BEGIN
  SELECT RAISE(ABORT, 'trust_authorization_policy is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_authorization_policy_no_delete` BEFORE DELETE ON `trust_authorization_policy` BEGIN
  SELECT RAISE(ABORT, 'trust_authorization_policy is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_authorization_policy_no_replace` BEFORE INSERT ON `trust_authorization_policy` WHEN EXISTS (SELECT 1 FROM `trust_authorization_policy` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_authorization_policy is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_request_kind_shape` BEFORE INSERT ON `trust_disbursement_request`
WHEN NEW.`kind` NOT IN ('disbursement', 'earned_fee_application')
  OR (NEW.`kind` = 'earned_fee_application' AND (NEW.`operating_description` IS NULL OR length(NEW.`operating_description`) = 0))
  OR (NEW.`kind` = 'disbursement' AND NEW.`operating_description` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement request is a disbursement or an earned-fee application, and only an application carries an operating-leg description');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_request_policy_is_current` BEFORE INSERT ON `trust_disbursement_request`
WHEN EXISTS (SELECT 1 FROM `trust_authorization_policy`)
  AND (NEW.`policy_id` IS NULL OR NEW.`policy_id` <> (SELECT `id` FROM `trust_authorization_policy` ORDER BY `version` DESC LIMIT 1))
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement request is submitted under the current authorization policy version');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_rejection_by_requester` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'rejected'
  AND NEW.`decided_by` = (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'only another member may reject a trust disbursement request; the member who submitted it withdraws it instead');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_withdrawal_by_requester` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'withdrawn'
  AND NEW.`decided_by` <> (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'only the member who requested a trust disbursement may withdraw it; another member rejects it with a reason');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_approver_differs` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'approved'
  AND (NEW.`authorization_basis` IS NULL OR NEW.`authorization_basis` = 'second_person')
  AND NEW.`decided_by` = (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'a trust disbursement must be decided by a member other than the one who requested it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_exception_basis_is_self` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` IN ('sole_trust_manager', 'policy_exempt')
  AND NEW.`decided_by` <> (SELECT `requested_by` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'an exception basis records a submitter approving their own request; a different approver is an ordinary second-person approval');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_sole_basis_requires_lone_manager` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'sole_trust_manager'
  AND ((SELECT COUNT(*) FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:manage' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:manage' AND m.`status` = 'active'
      )) > 1
    OR NOT EXISTS (SELECT 1 FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:manage' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:manage' AND m.`status` = 'active'
      ) WHERE `user_id` = NEW.`decided_by`))
BEGIN
  SELECT RAISE(ABORT, 'the sole-authorizer exception belongs to the firm''s only member holding trust:manage; either this firm has more than one, or the deciding member is not that member');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_sole_basis_requires_two_person_policy` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'sole_trust_manager'
  AND (SELECT CASE
         WHEN r.`policy_id` IS NULL THEN 0
         WHEN p.`policy` = 'off' THEN 1
         WHEN p.`policy` = 'threshold' AND r.`amount_minor` <= p.`threshold_amount_minor` THEN 1
         ELSE 0 END
       FROM `trust_disbursement_request` r
       LEFT JOIN `trust_authorization_policy` p ON p.`id` = r.`policy_id`
       WHERE r.`id` = NEW.`request_id`) = 1
BEGIN
  SELECT RAISE(ABORT, 'the authorization policy this request was submitted under does not require a second person for this amount; the basis for the submitter acting alone under it is policy_exempt');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_exempt_basis_requires_exempting_policy` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`authorization_basis` = 'policy_exempt'
  AND (SELECT CASE
         WHEN r.`policy_id` IS NULL THEN 0
         WHEN p.`policy` = 'off' THEN 1
         WHEN p.`policy` = 'threshold' AND r.`amount_minor` <= p.`threshold_amount_minor` THEN 1
         ELSE 0 END
       FROM `trust_disbursement_request` r
       LEFT JOIN `trust_authorization_policy` p ON p.`id` = r.`policy_id`
       WHERE r.`id` = NEW.`request_id`) = 0
BEGIN
  SELECT RAISE(ABORT, 'the authorization policy this request was submitted under requires a second person for this amount');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_approver_holds_authority` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'approved'
  AND (SELECT COALESCE(p.`require_authorized_approver`, 0)
       FROM `trust_disbursement_request` r
       LEFT JOIN `trust_authorization_policy` p ON p.`id` = r.`policy_id`
       WHERE r.`id` = NEW.`request_id`) = 1
  AND NOT EXISTS (SELECT 1 FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:authorize' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:authorize' AND m.`status` = 'active'
      ) WHERE `user_id` = NEW.`decided_by`)
BEGIN
  SELECT RAISE(ABORT, 'this firm requires trust money movement to be authorized by a member holding the authority to act (trust:authorize), and the deciding member does not hold it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_posting_matches_kind` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`decision` = 'approved'
  AND ((SELECT `kind` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`) = 'disbursement') <> (NEW.`movement_id` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'an approval posts what its request proposes: a trust movement for a disbursement, a trust-to-operating transfer for an earned-fee application');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_movement_names_decider` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`movement_id` IS NOT NULL
  AND (SELECT `authorized_by` FROM `trust_movement` WHERE `id` = NEW.`movement_id`) IS NOT NEW.`decided_by`
BEGIN
  SELECT RAISE(ABORT, 'the movement an approval posts must name the approving member as the member who authorized it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_transfer_names_decider_and_request` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`transfer_id` IS NOT NULL
  AND ((SELECT `authorized_by` FROM `trust_transfer` WHERE `id` = NEW.`transfer_id`) IS NOT NEW.`decided_by`
    OR (SELECT `approved_request_id` FROM `trust_transfer` WHERE `id` = NEW.`transfer_id`) IS NOT NEW.`request_id`
    OR (SELECT `amount_minor` FROM `trust_transfer` WHERE `id` = NEW.`transfer_id`) <> (SELECT `amount_minor` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`))
BEGIN
  SELECT RAISE(ABORT, 'the transfer an approval posts must name the approving member, the request it was approved from, and the requested amount');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_application_lines_sum` BEFORE INSERT ON `trust_disbursement_decision`
WHEN NEW.`transfer_id` IS NOT NULL
  AND (SELECT `amount_minor` FROM `trust_disbursement_request` WHERE `id` = NEW.`request_id`)
      <> (SELECT COALESCE(SUM(`amount_minor`), 0) FROM `invoice_trust_application_line` WHERE `request_id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'an earned-fee application settles exactly the invoice amounts its request proposed');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_update` BEFORE UPDATE ON `trust_disbursement_decision` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_delete` BEFORE DELETE ON `trust_disbursement_decision` BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_disbursement_decision_no_replace` BEFORE INSERT ON `trust_disbursement_decision` WHEN EXISTS (SELECT 1 FROM `trust_disbursement_decision` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_disbursement_decision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_names_actors` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`recorded_by` IS NULL OR NEW.`authorized_by` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a transfer out of trust names the member who recorded it and the member who authorized it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_approved_request_shape` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`approved_request_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `trust_disbursement_request` r
        WHERE r.`id` = NEW.`approved_request_id`
          AND r.`kind` = 'earned_fee_application'
          AND r.`requested_by` = NEW.`recorded_by`
          AND r.`policy_id` IS NEW.`policy_id`
          AND r.`amount_minor` = NEW.`amount_minor`
          AND NOT EXISTS (SELECT 1 FROM `trust_disbursement_decision` d WHERE d.`request_id` = r.`id`))
BEGIN
  SELECT RAISE(ABORT, 'a transfer approved from the authorization queue must record the submitting member, carry the policy version and amount stamped on its pending earned-fee application request, and claim a request nobody has decided');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_policy_is_current` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`approved_request_id` IS NULL
  AND EXISTS (SELECT 1 FROM `trust_authorization_policy`)
  AND (NEW.`policy_id` IS NULL OR NEW.`policy_id` <> (SELECT `id` FROM `trust_authorization_policy` ORDER BY `version` DESC LIMIT 1))
BEGIN
  SELECT RAISE(ABORT, 'a transfer out of trust is governed by the current authorization policy version');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_requires_second_person` BEFORE INSERT ON `trust_transfer`
WHEN NEW.`recorded_by` = NEW.`authorized_by`
  AND (CASE
         WHEN NEW.`policy_id` IS NULL THEN 0
         WHEN (SELECT `policy` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`) = 'off' THEN 1
         WHEN (SELECT `policy` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`) = 'threshold'
           AND NEW.`amount_minor` <= (SELECT `threshold_amount_minor` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`) THEN 1
         ELSE 0 END) = 0
  AND ((SELECT COUNT(*) FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:manage' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:manage' AND m.`status` = 'active'
      )) > 1
    OR NOT EXISTS (SELECT 1 FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:manage' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:manage' AND m.`status` = 'active'
      ) WHERE `user_id` = NEW.`authorized_by`))
BEGIN
  SELECT RAISE(ABORT, 'this firm requires a second person to authorize money leaving a client ledger at this amount; submit it as a pending earned-fee application for another member to approve');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_transfer_authorizer_holds_authority` BEFORE INSERT ON `trust_transfer`
WHEN (SELECT COALESCE((SELECT `require_authorized_approver` FROM `trust_authorization_policy` WHERE `id` = NEW.`policy_id`), 0)) = 1
  AND NOT EXISTS (SELECT 1 FROM (
        SELECT mr.`member_user_id` AS `user_id`
          FROM `member_role` mr
          JOIN `role_permission` rp ON rp.`role_id` = mr.`role_id`
          JOIN `member` m ON m.`user_id` = mr.`member_user_id`
         WHERE rp.`permission` = 'trust:authorize' AND m.`status` = 'active'
        UNION
        SELECT dg.`member_user_id`
          FROM `direct_grant` dg
          JOIN `member` m ON m.`user_id` = dg.`member_user_id`
         WHERE dg.`permission` = 'trust:authorize' AND m.`status` = 'active'
      ) WHERE `user_id` = NEW.`authorized_by`)
BEGIN
  SELECT RAISE(ABORT, 'this firm requires trust money movement to be authorized by a member holding the authority to act (trust:authorize), and the authorizing member does not hold it');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_request_shape` BEFORE INSERT ON `invoice_trust_application_line`
WHEN NOT EXISTS (SELECT 1 FROM `trust_disbursement_request` r
      WHERE r.`id` = NEW.`request_id` AND r.`kind` = 'earned_fee_application' AND r.`currency` = NEW.`currency`)
  OR EXISTS (SELECT 1 FROM `trust_disbursement_decision` d WHERE d.`request_id` = NEW.`request_id`)
BEGIN
  SELECT RAISE(ABORT, 'an application line belongs to a pending earned-fee application request in the same currency');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_no_update` BEFORE UPDATE ON `invoice_trust_application_line` BEGIN
  SELECT RAISE(ABORT, 'invoice_trust_application_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_no_delete` BEFORE DELETE ON `invoice_trust_application_line` BEGIN
  SELECT RAISE(ABORT, 'invoice_trust_application_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_trust_application_line_no_replace` BEFORE INSERT ON `invoice_trust_application_line` WHEN EXISTS (SELECT 1 FROM `invoice_trust_application_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'invoice_trust_application_line is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_billing_arrangement_version_dense` BEFORE INSERT ON `matter_billing_arrangement`
WHEN NEW.`version` <> (SELECT COALESCE(MAX(`version`), 0) + 1 FROM `matter_billing_arrangement` WHERE `matter_id` = NEW.`matter_id`)
BEGIN
  SELECT RAISE(ABORT, 'a billing arrangement version must be the next version for its matter; re-read the agreement in force and amend it again');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_billing_arrangement_close_only` BEFORE UPDATE ON `matter_billing_arrangement`
WHEN OLD.`valid_to` IS NOT NULL
  OR NEW.`valid_to` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`version` <> OLD.`version`
  OR NEW.`kind` <> OLD.`kind`
  OR NEW.`flat_fee_amount_minor` IS NOT OLD.`flat_fee_amount_minor`
  OR NEW.`contingency_share_e4` IS NOT OLD.`contingency_share_e4`
  OR NEW.`contingency_basis` IS NOT OLD.`contingency_basis`
  OR NEW.`retainer_target_minor` IS NOT OLD.`retainer_target_minor`
  OR NEW.`retainer_threshold_minor` IS NOT OLD.`retainer_threshold_minor`
  OR NEW.`advance_deposit_destination` IS NOT OLD.`advance_deposit_destination`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`valid_from` <> OLD.`valid_from`
  OR NEW.`created_at` <> OLD.`created_at`
  OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN
  SELECT RAISE(ABORT, 'a billing arrangement is append-only: a fee change is a new version, and the only edit an open version takes is closing its valid_to when superseded');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_billing_arrangement_no_delete` BEFORE DELETE ON `matter_billing_arrangement` BEGIN
  SELECT RAISE(ABORT, 'matter_billing_arrangement is append-only: history is the point, and a version an invoice was computed under must outlive the agreement that superseded it');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_billing_arrangement_no_replace` BEFORE INSERT ON `matter_billing_arrangement` WHEN EXISTS (SELECT 1 FROM `matter_billing_arrangement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_billing_arrangement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_recovery_void_only` BEFORE UPDATE ON `matter_recovery`
WHEN OLD.`voided_at` IS NOT NULL
  OR NEW.`voided_at` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`amount_minor` <> OLD.`amount_minor`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`recovered_date` <> OLD.`recovered_date`
  OR NEW.`description` <> OLD.`description`
  OR NEW.`recorded_by` IS NOT OLD.`recorded_by`
  OR NEW.`recorded_at` <> OLD.`recorded_at`
BEGIN
  SELECT RAISE(ABORT, 'a recorded recovery is corrected by voiding it with a reason and recording a new one, never edited');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_recovery_no_delete` BEFORE DELETE ON `matter_recovery` BEGIN
  SELECT RAISE(ABORT, 'matter_recovery is append-only: a recovery entered in error is voided with a reason, not erased');
END;
--> statement-breakpoint
CREATE TRIGGER `matter_recovery_no_replace` BEFORE INSERT ON `matter_recovery` WHEN EXISTS (SELECT 1 FROM `matter_recovery` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'matter_recovery is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `retainer_replenishment_request_resolve_only` BEFORE UPDATE ON `retainer_replenishment_request`
WHEN OLD.`resolved_at` IS NOT NULL
  OR NEW.`resolved_at` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`arrangement_id` <> OLD.`arrangement_id`
  OR NEW.`observed_balance_minor` <> OLD.`observed_balance_minor`
  OR NEW.`requested_amount_minor` <> OLD.`requested_amount_minor`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`requested_at` <> OLD.`requested_at`
  OR NEW.`requested_by` IS NOT OLD.`requested_by`
BEGIN
  SELECT RAISE(ABORT, 'a replenishment request takes exactly one edit: its resolution');
END;
--> statement-breakpoint
CREATE TRIGGER `retainer_replenishment_request_no_delete` BEFORE DELETE ON `retainer_replenishment_request` BEGIN
  SELECT RAISE(ABORT, 'retainer_replenishment_request is append-only apart from its resolution');
END;
--> statement-breakpoint
CREATE TRIGGER `retainer_replenishment_request_no_replace` BEFORE INSERT ON `retainer_replenishment_request` WHEN EXISTS (SELECT 1 FROM `retainer_replenishment_request` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'retainer_replenishment_request is append-only apart from its resolution');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_firm_funds_movement_no_update` BEFORE UPDATE ON `trust_firm_funds_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_firm_funds_movement is append-only; correct a firm-funds movement with a reversing entry and its own record');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_firm_funds_movement_no_delete` BEFORE DELETE ON `trust_firm_funds_movement` BEGIN
  SELECT RAISE(ABORT, 'trust_firm_funds_movement is append-only; correct a firm-funds movement with a reversing entry and its own record');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_firm_funds_movement_no_replace` BEFORE INSERT ON `trust_firm_funds_movement` WHEN EXISTS (SELECT 1 FROM `trust_firm_funds_movement` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_firm_funds_movement is append-only; an INSERT OR REPLACE would rewrite a recorded movement');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_firm_funds_movement_requires_firm_funds_node` BEFORE INSERT ON `trust_firm_funds_movement`
WHEN NOT EXISTS (
  SELECT 1 FROM `trust_ledger_node` n WHERE n.`trust_account_id` = NEW.`trust_account_id` AND n.`kind` = 'firm_funds'
) BEGIN
  SELECT RAISE(ABORT, 'this trust account keeps none of the firm''s own funds; open the bank-charge carve-out on it before recording a firm-funds movement against it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_no_update` BEFORE UPDATE ON `trust_unclaimed_funds_review` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review is append-only; a review records what a person saw when they opened it');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_no_delete` BEFORE DELETE ON `trust_unclaimed_funds_review` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review is append-only; a review that was opened stays opened');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_no_replace` BEFORE INSERT ON `trust_unclaimed_funds_review` WHEN EXISTS (SELECT 1 FROM `trust_unclaimed_funds_review` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review is append-only; an INSERT OR REPLACE would rewrite a recorded review');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_node_is_a_matter_leaf` BEFORE INSERT ON `trust_unclaimed_funds_review`
WHEN NOT EXISTS (
  SELECT 1 FROM `trust_ledger_node` n WHERE n.`id` = NEW.`node_id` AND n.`kind` = 'matter' AND n.`trust_account_id` = NEW.`trust_account_id`
) BEGIN
  SELECT RAISE(ABORT, 'an unclaimed-funds review is about one client matter ledger under the trust account it names');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_no_update` BEFORE UPDATE ON `trust_unclaimed_funds_contact_attempt` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_contact_attempt is append-only; correct an attempt by recording a further one that says so');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_no_delete` BEFORE DELETE ON `trust_unclaimed_funds_contact_attempt` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_contact_attempt is append-only; an attempt that was made cannot be un-made');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_no_replace` BEFORE INSERT ON `trust_unclaimed_funds_contact_attempt` WHEN EXISTS (SELECT 1 FROM `trust_unclaimed_funds_contact_attempt` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_contact_attempt is append-only; an INSERT OR REPLACE would rewrite a recorded attempt');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_contact_attempt_review_is_open` BEFORE INSERT ON `trust_unclaimed_funds_contact_attempt`
WHEN EXISTS (
  SELECT 1 FROM `trust_unclaimed_funds_review_closure` c WHERE c.`review_id` = NEW.`review_id`
) BEGIN
  SELECT RAISE(ABORT, 'this unclaimed-funds review is closed; record a further attempt against a new review');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_no_update` BEFORE UPDATE ON `trust_unclaimed_funds_review_closure` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review_closure is append-only; a review is closed once, and a later round is a new review');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_no_delete` BEFORE DELETE ON `trust_unclaimed_funds_review_closure` BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review_closure is append-only; a closed review cannot be reopened');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_no_replace` BEFORE INSERT ON `trust_unclaimed_funds_review_closure` WHEN EXISTS (SELECT 1 FROM `trust_unclaimed_funds_review_closure` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'trust_unclaimed_funds_review_closure is append-only; an INSERT OR REPLACE would rewrite a recorded closure');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_unclaimed_funds_review_closure_movement_is_this_ledger` BEFORE INSERT ON `trust_unclaimed_funds_review_closure`
WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `trust_movement` m
    JOIN `trust_unclaimed_funds_review` r ON r.`id` = NEW.`review_id`
   WHERE m.`id` = NEW.`movement_id` AND m.`node_id` = r.`node_id` AND m.`kind` = 'disbursement'
) BEGIN
  SELECT RAISE(ABORT, 'the movement a closure names must be a disbursement from the client ledger under review');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_no_update` BEFORE UPDATE ON `credit_note` BEGIN
  SELECT RAISE(ABORT, 'credit_note is append-only; a wrong credit note is answered by a further correction, never by an edit');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_no_delete` BEFORE DELETE ON `credit_note` BEGIN
  SELECT RAISE(ABORT, 'credit_note is append-only; a wrong credit note is answered by a further correction, never by a deletion');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_no_replace` BEFORE INSERT ON `credit_note` WHEN EXISTS (SELECT 1 FROM `credit_note` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'credit_note is append-only; an INSERT OR REPLACE would rewrite an issued correction');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_requires_finalized_invoice` BEFORE INSERT ON `credit_note`
WHEN NOT EXISTS (SELECT 1 FROM `invoice` WHERE `id` = NEW.`invoice_id` AND `status` = 'final') BEGIN
  SELECT RAISE(ABORT, 'a credit note corrects a finalized invoice; a draft is edited and a voided draft asserted nothing');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_no_update` BEFORE UPDATE ON `credit_note_line` BEGIN
  SELECT RAISE(ABORT, 'credit_note_line is append-only; it is frozen with the note it belongs to');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_no_delete` BEFORE DELETE ON `credit_note_line` BEGIN
  SELECT RAISE(ABORT, 'credit_note_line is append-only; it is frozen with the note it belongs to');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_no_replace` BEFORE INSERT ON `credit_note_line` WHEN EXISTS (SELECT 1 FROM `credit_note_line` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'credit_note_line is append-only; an INSERT OR REPLACE would rewrite an issued correction');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_note_line_credits_a_line_of_the_same_bill` BEFORE INSERT ON `credit_note_line`
WHEN NEW.`credits_invoice_line_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `invoice_line` l
    JOIN `credit_note` n ON n.`id` = NEW.`credit_note_id`
   WHERE l.`id` = NEW.`credits_invoice_line_id`
     AND l.`invoice_id` = n.`invoice_id`
     AND l.`matter_id` = NEW.`matter_id`
) BEGIN
  SELECT RAISE(ABORT, 'a credit note line may only credit a line of the invoice it corrects, on its own matter');
END;
--> statement-breakpoint
CREATE TRIGGER `client_credit_only_discharge_moves` BEFORE UPDATE ON `client_credit`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`client_entity_id` <> OLD.`client_entity_id`
  OR NEW.`matter_id` <> OLD.`matter_id`
  OR NEW.`credit_note_id` <> OLD.`credit_note_id`
  OR NEW.`amount_minor` <> OLD.`amount_minor`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`opened_at` <> OLD.`opened_at`
  OR COALESCE(NEW.`opened_by`, '') <> COALESCE(OLD.`opened_by`, '') BEGIN
  SELECT RAISE(ABORT, 'a client credit records an obligation that was fixed when it opened; only the amount discharged moves');
END;
--> statement-breakpoint
CREATE TRIGGER `client_credit_no_delete` BEFORE DELETE ON `client_credit` BEGIN
  SELECT RAISE(ABORT, 'client_credit is never deleted; money the firm has conceded is not its own does not stop existing because a row was removed');
END;
--> statement-breakpoint
CREATE TRIGGER `client_credit_no_replace` BEFORE INSERT ON `client_credit` WHEN EXISTS (SELECT 1 FROM `client_credit` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'client_credit is never overwritten; an INSERT OR REPLACE would erase an open obligation');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_credit_note_paired` BEFORE INSERT ON `invoice_application`
WHEN (NEW.`kind` = 'credit_note') <> (NEW.`credit_note_id` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'a credit_note application names the note it came from, and nothing else may');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_client_credit_paired` BEFORE INSERT ON `invoice_application`
WHEN (NEW.`kind` = 'client_credit') <> (NEW.`client_credit_id` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'a client_credit application names the credit it draws on, and nothing else may');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_entry_paired` BEFORE INSERT ON `invoice_application`
WHEN (NEW.`kind` IN ('trust_transfer', 'credit_note')) <> (NEW.`entry_id` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a trust transfer''s posting is trust''s and a credit note''s sits on the note; every other application records its own');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_application_reason_required` BEFORE INSERT ON `invoice_application`
WHEN NEW.`kind` IN ('write_off', 'reversal')
 AND (NEW.`reason` IS NULL OR length(trim(NEW.`reason`)) = 0) BEGIN
  SELECT RAISE(ABORT, 'a write-off and a reversal each state why; an unexplained one is indistinguishable from a mistake');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_recheck_request_cause_immutable` BEFORE UPDATE ON `conflicts_recheck_request`
WHEN OLD.`id` IS NOT NEW.`id`
  OR OLD.`matter_id` IS NOT NEW.`matter_id`
  OR OLD.`cause_topic` IS NOT NEW.`cause_topic`
  OR OLD.`cause_reference` IS NOT NEW.`cause_reference`
  OR OLD.`cause_occurred_at` IS NOT NEW.`cause_occurred_at`
  OR OLD.`requested_at` IS NOT NEW.`requested_at`
BEGIN
  SELECT RAISE(ABORT, 'conflicts_recheck_request records its cause once');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_recheck_request_satisfaction_final` BEFORE UPDATE ON `conflicts_recheck_request`
WHEN OLD.`satisfied_at` IS NOT NULL
  AND (NEW.`satisfied_at` IS NOT OLD.`satisfied_at` OR NEW.`satisfied_by_check_id` IS NOT OLD.`satisfied_by_check_id`)
BEGIN
  SELECT RAISE(ABORT, 'a satisfied conflicts_recheck_request is final');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_recheck_request_no_delete` BEFORE DELETE ON `conflicts_recheck_request` BEGIN
  SELECT RAISE(ABORT, 'conflicts_recheck_request rows are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_recheck_request_no_replace` BEFORE INSERT ON `conflicts_recheck_request` WHEN EXISTS (SELECT 1 FROM `conflicts_recheck_request` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'conflicts_recheck_request records its cause once');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_delivery_no_update` BEFORE UPDATE ON `invoice_delivery` BEGIN
  SELECT RAISE(ABORT, 'invoice_delivery is append-only; a delivery is a dated attempt that either happened or did not, never a row to be restated');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_delivery_no_delete` BEFORE DELETE ON `invoice_delivery` BEGIN
  SELECT RAISE(ABORT, 'invoice_delivery is append-only; removing a recorded delivery would erase the firm''s own evidence that it gave a client a bill');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_delivery_no_replace` BEFORE INSERT ON `invoice_delivery` WHEN EXISTS (SELECT 1 FROM `invoice_delivery` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'invoice_delivery is append-only; an INSERT OR REPLACE would rewrite a recorded delivery');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_delivery_requires_finalized_invoice` BEFORE INSERT ON `invoice_delivery`
WHEN NOT EXISTS (SELECT 1 FROM `invoice` WHERE `id` = NEW.`invoice_id` AND `status` = 'final') BEGIN
  SELECT RAISE(ABORT, 'a delivery records that a finalized bill was given to a client; a draft is still being written and a voided draft was never issued');
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_delivery_not_before_issue` BEFORE INSERT ON `invoice_delivery`
WHEN EXISTS (SELECT 1 FROM `invoice` WHERE `id` = NEW.`invoice_id` AND `issue_date` IS NOT NULL AND NEW.`delivery_date` < `issue_date`) BEGIN
  SELECT RAISE(ABORT, 'a delivery cannot predate the bill it delivered');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_waiver_record_only_on_waiver` BEFORE INSERT ON `conflicts_disposition` WHEN NEW.`kind` <> 'waiver_obtained' AND (NEW.`waiver_given_by_entity_id` IS NOT NULL OR NEW.`waiver_confirmed_in_writing` IS NOT NULL OR NEW.`waiver_document_file_id` IS NOT NULL OR NEW.`waiver_given_on` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'only a waiver_obtained disposition carries a waiver record');
END;
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_originalWill000000000', 'Original will', 'WILL', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_codicil00000000000000', 'Codicil', 'CODICIL', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_deed00000000000000000', 'Deed', 'DEED', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_powerOfAttorney000000', 'Power of attorney', 'POA', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_trustInstrument000000', 'Trust instrument', 'TRUST', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_shareCertificate00000', 'Share or stock certificate', 'SHARE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_bearerSecurity0000000', 'Bearer security', 'BEARER', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_titleDocument00000000', 'Title document', 'TITLE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_promissoryNote0000000', 'Promissory note', 'NOTE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_vitalRecord0000000000', 'Birth or marriage certificate', 'VITAL', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_passport0000000000000', 'Passport', 'PASSPORT', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_jewelryOrValuable0000', 'Jewelry or valuable', 'VALUABLE', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_sealedInstructions000', 'Sealed instructions', 'SEALED', 1, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_keys00000000000000000', 'Keys', 'KEYS', 0, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_storageMedia000000000', 'Storage media', 'MEDIA', 0, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `custody_item_type` (`id`, `name`, `code`, `intrinsic_value_default`, `active`, `created_at`, `updated_at`) VALUES ('custodyItemType_other0000000000000000', 'Other', 'OTHER', 0, 1, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_singleFamilyResidence', 'Single-family residence', 'realProperty', 'RESIDENCE', 1, 1, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_condominium0000000000', 'Condominium', 'realProperty', 'CONDOMINIUM', 1, 2, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_vacantLand00000000000', 'Vacant land', 'realProperty', 'VACANT_LAND', 1, 3, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_timeshare000000000000', 'Timeshare', 'realProperty', 'TIMESHARE', 1, 4, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_mineralInterest0000000', 'Mineral interest', 'realProperty', 'MINERAL_INTEREST', 1, 5, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_leasehold000000000000', 'Leasehold', 'realProperty', 'LEASEHOLD', 1, 6, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_checkingAccount000000', 'Checking account', 'financialAccount', 'CHECKING', 1, 1, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_savingsAccount0000000', 'Savings account', 'financialAccount', 'SAVINGS', 1, 2, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_brokerageAccount00000', 'Brokerage account', 'financialAccount', 'BROKERAGE', 1, 3, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_certificateOfDeposit0', 'Certificate of deposit', 'financialAccount', 'CERTIFICATE_OF_DEPOSIT', 1, 4, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_individualRetirement0', 'Individual retirement account', 'financialAccount', 'INDIVIDUAL_RETIREMENT', 1, 5, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_employerRetirement000', 'Employer retirement plan', 'financialAccount', 'EMPLOYER_RETIREMENT', 1, 6, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_educationSavings00000', 'Education savings account', 'financialAccount', 'EDUCATION_SAVINGS', 1, 7, '2026-08-06T02:00:00.000Z', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_passengerVehicle00000', 'Passenger vehicle', 'vehicle', 'PASSENGER_VEHICLE', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_truckOrVan00000000000', 'Truck or van', 'vehicle', 'TRUCK_OR_VAN', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_motorcycle00000000000', 'Motorcycle', 'vehicle', 'MOTORCYCLE', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_recreationalVehicle00', 'Recreational vehicle', 'vehicle', 'RECREATIONAL_VEHICLE', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_boatOrVessel000000000', 'Boat or vessel', 'vehicle', 'BOAT_OR_VESSEL', 1, 5, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_trailer00000000000000', 'Trailer', 'vehicle', 'TRAILER', 1, 6, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_handgun00000000000000', 'Handgun', 'firearm', 'HANDGUN', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_rifle0000000000000000', 'Rifle', 'firearm', 'RIFLE', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_shotgun00000000000000', 'Shotgun', 'firearm', 'SHOTGUN', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_antiqueFirearm0000000', 'Antique or collectible firearm', 'firearm', 'ANTIQUE_FIREARM', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_limitedLiability00000', 'Limited liability company interest', 'businessInterest', 'LIMITED_LIABILITY_COMPANY', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_corporateShares000000', 'Corporate shares', 'businessInterest', 'CORPORATE_SHARES', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_partnershipInterest00', 'Partnership interest', 'businessInterest', 'PARTNERSHIP_INTEREST', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_soleProprietorship000', 'Sole proprietorship', 'businessInterest', 'SOLE_PROPRIETORSHIP', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_termLife0000000000000', 'Term life policy', 'insurancePolicy', 'TERM_LIFE', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_wholeLife000000000000', 'Whole life policy', 'insurancePolicy', 'WHOLE_LIFE', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_universalLife00000000', 'Universal life policy', 'insurancePolicy', 'UNIVERSAL_LIFE', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_annuity00000000000000', 'Annuity', 'insurancePolicy', 'ANNUITY', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_promissoryNote0000000', 'Promissory note', 'receivable', 'PROMISSORY_NOTE', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_loanToFamilyMember000', 'Loan to a family member', 'receivable', 'FAMILY_LOAN', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_judgmentOwed000000000', 'Judgment owed to the estate', 'receivable', 'JUDGMENT_OWED', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_refundDue000000000000', 'Refund due', 'receivable', 'REFUND_DUE', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_cryptocurrency0000000', 'Cryptocurrency', 'digitalAsset', 'CRYPTOCURRENCY', 1, 1, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_onlineAccount00000000', 'Online account', 'digitalAsset', 'ONLINE_ACCOUNT', 1, 2, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_domainName00000000000', 'Domain name', 'digitalAsset', 'DOMAIN_NAME', 1, 3, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_asset_type` (`id`, `name`, `class`, `code`, `active`, `position`, `created_at`, `updated_at`) VALUES ('matterAssetType_digitalMediaLibrary00', 'Digital media library', 'digitalAsset', 'DIGITAL_MEDIA_LIBRARY', 1, 4, '2026-08-06T07:00:00.000Z', '2026-08-06T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_hearing00000000000000', 'Hearing', 'HEARING', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_trial0000000000000000', 'Trial', 'TRIAL', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_filing000000000000000', 'Filing', 'FILING', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_service00000000000000', 'Service', 'SERVICE', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_orderEntered000000000', 'Order entered', 'ORDER', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_judgmentEntered000000', 'Judgment entered', 'JUDGMENT', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_deposition00000000000', 'Deposition', 'DEPO', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_mediation000000000000', 'Mediation', 'MEDIATION', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_arbitration0000000000', 'Arbitration', 'ARBITRATION', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_settlementConference0', 'Settlement conference', 'SETTLEMENT', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_statusConference00000', 'Status conference', 'STATUS', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_discoveryCutOff000000', 'Discovery cut-off', 'DISCOVERY', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_appealFiled0000000000', 'Appeal filed', 'APPEAL', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_noticeReceived0000000', 'Notice received', 'NOTICE', 'litigation', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_clientMeeting00000000', 'Client meeting', 'MEETING', 'firm', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_siteVisit000000000000', 'Site visit', 'SITEVISIT', 'firm', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_call00000000000000000', 'Call', 'CALL', 'firm', 'platform', 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_firmMeeting0000000000', 'Firm meeting', 'FIRMMEETING', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_training0000000000000', 'Training', 'TRAINING', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_officeClosure00000000', 'Office closure', 'CLOSURE', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_firmHoliday0000000000', 'Firm holiday', 'HOLIDAY', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');
--> statement-breakpoint
INSERT INTO `matter_event_type` (`id`, `name`, `code`, `category`, `origin`, `active`, `created_at`, `updated_at`) VALUES ('matterEventType_reservation0000000000', 'Reservation', 'RESERVATION', 'firm', 'platform', 1, '2026-08-07T07:00:00.000Z', '2026-08-07T07:00:00.000Z');
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
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Zo8dSaE34nkuzd8b92ts6', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileRepair');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ug4h4xKKBpHWrJHIeM7er', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileRepair');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_ePUvHOdoXlvJ2BnfL4AGZ', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileRepair');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Vr6SpPSZdcmeohmxma06U', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileRepair');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_CViT3l-7azrB_XOJRZjPL', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileRepair');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Nq7Bx2fT9mLd4kRvZa1cP', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:speedTest');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Hs5Yw8jK3nQz6bXeM0vGt', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:speedTest');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Dc9Rf4pW7uJi2lNoS5hAe', 'role_917LCQyRKP50Z9bW89vXl', 'tools:speedTest');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Kt3Gm6zV1yCb8xUqE7nPd', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:speedTest');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Bw2Ln5aX0oFj9sTgR4iMc', 'role_WojF9F7kksBEftsmZGNhb', 'tools:speedTest');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_QXbw0CF8FQl-rsSIH-bjg', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:ocr');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_xIsqtOvYCONGnys3ezGHr', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:ocr');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AdFGF4-Rph9Evh8sEMzl7', 'role_917LCQyRKP50Z9bW89vXl', 'tools:ocr');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_964-YIg_2rsTe2iNiSwuI', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:ocr');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_H7Yx3BvP6Dg1sPGmA9VKa', 'role_WojF9F7kksBEftsmZGNhb', 'tools:ocr');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunOwnerAdm0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:run');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'conflicts:run');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunParalegl0', 'role_917LCQyRKP50Z9bW89vXl', 'conflicts:run');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunBilling00', 'role_hwwC1D98d8Lazc_asL6vO', 'conflicts:run');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsRunReadonly0', 'role_WojF9F7kksBEftsmZGNhb', 'conflicts:run');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadOwnerAd0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadAttorny0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'conflicts:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadParalgl0', 'role_917LCQyRKP50Z9bW89vXl', 'conflicts:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadBilling0', 'role_hwwC1D98d8Lazc_asL6vO', 'conflicts:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsReadReadony0', 'role_WojF9F7kksBEftsmZGNhb', 'conflicts:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsDisposeOwnr0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:dispose');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsDisposeAtty0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'conflicts:dispose');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_wN3fXjE8pQmZdRykbG5tv', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:emailInspector');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_LhK9cVoY72xTiWamF4uzs', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:emailInspector');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bR5tQnH38jSuNe0dyLkA1', 'role_917LCQyRKP50Z9bW89vXl', 'tools:emailInspector');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_pD8mWzX41oKrCfa6nBt7Y', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:emailInspector');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_qT2vJfN95hUiSoc3mXe8Z', 'role_WojF9F7kksBEftsmZGNhb', 'tools:emailInspector');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsFileOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:file');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsFileAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:file');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsFileParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'emails:file');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'emails:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'emails:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsReadReadOnly000', 'role_WojF9F7kksBEftsmZGNhb', 'emails:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsLinksOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:manageLinks');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsLinksAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:manageLinks');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsLinksParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'emails:manageLinks');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsAddrOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:manageCaptureAddresses');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSealOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'esign:seal');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_esignSealAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'esign:seal');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_templatesManageOwnAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'templates:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsAssembleOwnr', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:assemble');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsAssembleAtty', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:assemble');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsAssemblePara', 'role_917LCQyRKP50Z9bW89vXl', 'documents:assemble');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'custody:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'custody:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'custody:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'custody:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyReadReadOnly00', 'role_WojF9F7kksBEftsmZGNhb', 'custody:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyManageOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'custody:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyManageAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'custody:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_custodyManageParalegl', 'role_917LCQyRKP50Z9bW89vXl', 'custody:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'trust:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'trust:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustReadBilling00000', 'role_hwwC1D98d8Lazc_asL6vO', 'trust:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustManageOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustManageAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'trust:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustManageBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'trust:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsRulesOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'emails:manageAutoFileRules');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_emailsRulesAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'emails:manageAutoFileRules');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'billing:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingReadBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'billing:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:draft');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:draft');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'billing:draft');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingDraftBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'billing:draft');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingFinalizeOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:finalize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingFinalizeAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:finalize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingApplyOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:apply');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingApplyAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:apply');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingApplyBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'billing:apply');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingCreditOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:credit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingCreditAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'billing:credit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_billingConfigureOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'billing:configure');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadOwnerAdm0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'calendar:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'calendar:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'calendar:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadBilling00', 'role_hwwC1D98d8Lazc_asL6vO', 'calendar:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarReadReadOnly0', 'role_WojF9F7kksBEftsmZGNhb', 'calendar:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarManageOwnrAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'calendar:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarManageAttorny', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'calendar:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_calendarManageParalgl', 'role_917LCQyRKP50Z9bW89vXl', 'calendar:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matterAssets:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matterAssets:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'matterAssets:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetManageOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matterAssets:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetManageAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matterAssets:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_assetManageParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'matterAssets:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusConverseOwner00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'magnus:converse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusConverseAttorne', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'magnus:converse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusConverseParaleg', 'role_917LCQyRKP50Z9bW89vXl', 'magnus:converse');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_magnusReadAllOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'magnus:readAllConversations');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReadOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReadAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReadParaleg0', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryManageOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:manageReviewSets');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryManageAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:manageReviewSets');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryManageParale', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:manageReviewSets');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryLoadOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:load');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryLoadAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:load');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryLoadParaleg0', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:load');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'notifications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'notifications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'notifications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'notifications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyReadReadOnly00', 'role_WojF9F7kksBEftsmZGNhb', 'notifications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustAuthorizeOwner00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:authorize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustAuthorizeAttorne', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'trust:authorize');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReviewOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:review');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReviewAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:review');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryReviewParale', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:review');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryProduceOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'discovery:produce');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryProduceAttor', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'discovery:produce');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_discoveryProduceParal', 'role_917LCQyRKP50Z9bW89vXl', 'discovery:produce');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_trustFirmFundsOwnerAd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'trust:firmFunds');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsTrustComplianc', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:trustCompliance');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsFinancialOwner', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:financial');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsProductivityOw', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:productivity');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsOperationalOwn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:operational');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsProduceOwnerAd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:produce');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notifyPolicyOwnAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageNotificationPolicy');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsEdit00000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsEdit00000002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsEdit00000003', 'role_917LCQyRKP50Z9bW89vXl', 'documents:edit');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsCheckout0001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:checkout');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsCheckout0002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:checkout');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsCheckout0003', 'role_917LCQyRKP50Z9bW89vXl', 'documents:checkout');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsReconcile001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:reconcile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsReconcile002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:reconcile');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsForceRelease', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:forceReleaseLock');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings1', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:propertyListings');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings2', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:propertyListings');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings3', 'role_917LCQyRKP50Z9bW89vXl', 'tools:propertyListings');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings4', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:propertyListings');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings5', 'role_WojF9F7kksBEftsmZGNhb', 'tools:propertyListings');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords01', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:propertyRecords');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords02', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:propertyRecords');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords03', 'role_917LCQyRKP50Z9bW89vXl', 'tools:propertyRecords');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords04', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:propertyRecords');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords05', 'role_WojF9F7kksBEftsmZGNhb', 'tools:propertyRecords');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:businessLookup');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:businessLookup');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup003', 'role_917LCQyRKP50Z9bW89vXl', 'tools:businessLookup');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup004', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:businessLookup');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup005', 'role_WojF9F7kksBEftsmZGNhb', 'tools:businessLookup');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense01', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:attorneyLicense');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense02', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:attorneyLicense');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense03', 'role_917LCQyRKP50Z9bW89vXl', 'tools:attorneyLicense');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense04', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:attorneyLicense');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense05', 'role_WojF9F7kksBEftsmZGNhb', 'tools:attorneyLicense');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolShipping000000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:shipping');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:readMembers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'firm:readMembers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'firm:readMembers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersBilling000', 'role_hwwC1D98d8Lazc_asL6vO', 'firm:readMembers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_readMembersReadOnly00', 'role_WojF9F7kksBEftsmZGNhb', 'firm:readMembers');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportsExport00000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'reports:export');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfOwnerAd', 'role_Gw-zKO8hOHQuNv2bWokMp', 'downloads:shelf');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'downloads:shelf');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfParale', 'role_917LCQyRKP50Z9bW89vXl', 'downloads:shelf');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfBillin', 'role_hwwC1D98d8Lazc_asL6vO', 'downloads:shelf');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_downloadsShelfReadOn', 'role_WojF9F7kksBEftsmZGNhb', 'downloads:shelf');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileWorkbench');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileWorkbench');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileWorkbench');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileWorkbench');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fileBenchReadOnly000', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileWorkbench');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'notes:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'notes:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'notes:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesWriteOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'notes:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesWriteAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'notes:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_notesWriteParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'notes:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchOwner000', 'role_Gw-zKO8hOHQuNv2bWokMp', 'search:matter');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchAttorney', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'search:matter');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchParaleg0', 'role_917LCQyRKP50Z9bW89vXl', 'search:matter');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchBilling0', 'role_hwwC1D98d8Lazc_asL6vO', 'search:matter');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterSearchReadOnly', 'role_WojF9F7kksBEftsmZGNhb', 'search:matter');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadAttorney0000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadParalegal000', 'role_917LCQyRKP50Z9bW89vXl', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksReadBilling00000', 'role_hwwC1D98d8Lazc_asL6vO', 'tasks:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksWriteBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'tasks:write');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksAssignOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:assign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksAssignAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:assign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksAssignParalegal0', 'role_917LCQyRKP50Z9bW89vXl', 'tasks:assign');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksPlansOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tasks:managePlans');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_tasksPlansAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tasks:managePlans');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeReadOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'intake:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeReadAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'intake:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeReadParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'intake:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeReadBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'intake:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeRecordOwnerAdm0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'intake:record');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeRecordAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'intake:record');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeRecordParalega0', 'role_917LCQyRKP50Z9bW89vXl', 'intake:record');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeRecordBilling00', 'role_hwwC1D98d8Lazc_asL6vO', 'intake:record');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeWaiveOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'intake:waive');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeWaiveAttorney00', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'intake:waive');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeProcOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'intake:manageProcedures');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_intakeProcAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'intake:manageProcedures');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterHoldOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'matters:hold');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_matterHoldAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'matters:hold');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission__jezbuSezbvcdAzF3KxX8', 'role_Gw-zKO8hOHQuNv2bWokMp', 'communications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_cwwkVJsJQLAghji-KbNBc', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'communications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_disT2jR7b7z7ay3_yr2ci', 'role_917LCQyRKP50Z9bW89vXl', 'communications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_c1aJtqIS1S-lhx1caacyQ', 'role_hwwC1D98d8Lazc_asL6vO', 'communications:read');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Baf69lifyA8h7-FWkxAGJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'communications:log');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_hPGsNdfV2c9_zzN8BGIcd', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'communications:log');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_vm32cyr82L5w2OAXdHPsP', 'role_917LCQyRKP50Z9bW89vXl', 'communications:log');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_6qoTM6IrSQGs3ydWyKRkM', 'role_Gw-zKO8hOHQuNv2bWokMp', 'communications:reviewUnrouted');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_fyelnaJGiDxgGaJNTaqCr', 'role_917LCQyRKP50Z9bW89vXl', 'communications:reviewUnrouted');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_reportPolicyOwnAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageReportPolicy');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_conflictsConfigOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'conflicts:configure');
--> statement-breakpoint
INSERT INTO `setting` (`key`, `value`, `updated_at`) VALUES ('matterAssets.interestRoleCatalog', '["Owner","Joint owner","Co-owner","Titleholder","Life tenant","Remainderman","Trustee","Beneficiary","Payable-on-death beneficiary","Secured party","Lessee"]', '2026-08-06T02:00:00.000Z');
--> statement-breakpoint
INSERT INTO `trust_authorization_policy` (`id`, `version`, `policy`, `threshold_amount_minor`, `require_authorized_approver`, `set_by`, `set_at`) VALUES ('trustAuthorizationPolicy_platformDefault000000', 1, 'off', NULL, 1, 'user_platformPosture000000', '2026-08-08T02:00:00.000Z');
