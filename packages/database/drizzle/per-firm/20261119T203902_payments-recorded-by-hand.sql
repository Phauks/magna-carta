CREATE TABLE `payment_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `invoice_application`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_receipt_method_check" CHECK("payment_receipt"."method" IN ('check', 'cash', 'bank_transfer', 'card_terminal')),
	CONSTRAINT "payment_receipt_reference_nonempty_check" CHECK("payment_receipt"."reference" IS NULL OR length(trim("payment_receipt"."reference")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipt_application_unique_index` ON `payment_receipt` (`application_id`);--> statement-breakpoint
CREATE TRIGGER `payment_receipt_no_update` BEFORE UPDATE ON `payment_receipt` BEGIN
  SELECT RAISE(ABORT, 'payment_receipt is append-only; a payment recorded in error is undone by reversing its application, never by restating the receipt');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_no_delete` BEFORE DELETE ON `payment_receipt` BEGIN
  SELECT RAISE(ABORT, 'payment_receipt is append-only; removing a receipt would erase how money the firm received arrived');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_no_replace` BEFORE INSERT ON `payment_receipt` WHEN EXISTS (SELECT 1 FROM `payment_receipt` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'payment_receipt is append-only; an INSERT OR REPLACE would rewrite a recorded payment');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_names_a_payment` BEFORE INSERT ON `payment_receipt`
WHEN NOT EXISTS (SELECT 1 FROM `invoice_application` WHERE `id` = NEW.`application_id` AND `kind` = 'payment') BEGIN
  SELECT RAISE(ABORT, 'a receipt stands beside the payment application it produced, never beside a transfer, a credit or a write-off');
END;
