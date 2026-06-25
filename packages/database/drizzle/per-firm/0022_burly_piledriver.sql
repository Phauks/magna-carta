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