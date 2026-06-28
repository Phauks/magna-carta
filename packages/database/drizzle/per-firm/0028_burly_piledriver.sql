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
CREATE UNIQUE INDEX `cost_entry_recovery_ref_unique` ON `cost_entry` (`recovery_ref`) WHERE "cost_entry"."recovery_ref" IS NOT NULL;
-- Seed costs:track onto Owner/Admin, Attorney, and Paralegal, and costs:approve onto Owner/Admin
-- and Billing. The role_id literals are the handles minted in 0002_member-rbac.sql; the
-- rolePermission_ handles are minted once so every firm's defaults match byte-for-byte.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES
	('rolePermission_costs1TrackOwnerAdmin', 'role_Gw-zKO8hOHQuNv2bWokMp', 'costs:track'),
	('rolePermission_costs2TrackAttorney0', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'costs:track'),
	('rolePermission_costs3TrackParalegal', 'role_917LCQyRKP50Z9bW89vXl', 'costs:track'),
	('rolePermission_costs4ApproveOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'costs:approve'),
	('rolePermission_costs5ApproveBilling', 'role_hwwC1D98d8Lazc_asL6vO', 'costs:approve');
--> statement-breakpoint
-- Carry forward any pre-extraction timekeeping review-gate opt-in to the unified billing key: the
-- billing-core extraction renamed this firm-setting key from 'time.approval_required' to
-- 'billing.approval_required'. A no-op on firms that never set the old key (DML, not DDL — the
-- drizzle schema snapshot is unchanged).
UPDATE setting SET key = 'billing.approval_required' WHERE key = 'time.approval_required';
