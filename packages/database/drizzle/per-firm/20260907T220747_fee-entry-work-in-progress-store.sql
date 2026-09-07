CREATE TABLE `fee_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`service_date` text NOT NULL,
	`timekeeper_user_id` text,
	`description` text DEFAULT '' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`billable` integer NOT NULL,
	`status` text NOT NULL,
	`kick_back_reason` text,
	`invoice_id` text,
	`memo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fee_entry_status_check" CHECK("fee_entry"."status" IN ('draft','submitted','approved','billed','void')),
	CONSTRAINT "fee_entry_billable_check" CHECK("fee_entry"."billable" IN (0,1)),
	CONSTRAINT "fee_entry_currency_check" CHECK("fee_entry"."currency" IN ('USD')),
	CONSTRAINT "fee_entry_amount_check" CHECK("fee_entry"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `fee_entry_matter_status_index` ON `fee_entry` (`matter_id`,`status`);--> statement-breakpoint
CREATE INDEX `fee_entry_service_date_index` ON `fee_entry` (`service_date`);