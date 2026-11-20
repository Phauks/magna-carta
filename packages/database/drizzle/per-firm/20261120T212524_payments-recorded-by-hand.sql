CREATE TABLE `payment_deposit` (
	`id` text PRIMARY KEY NOT NULL,
	`deposit_to_account_id` text NOT NULL,
	`deposited_on` text NOT NULL,
	`slip_number` text,
	`currency` text NOT NULL,
	`entry_id` text NOT NULL,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`deposit_to_account_id`) REFERENCES `ledger_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_deposit_deposited_on_shape_check" CHECK("payment_deposit"."deposited_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "payment_deposit_slip_number_nonempty_check" CHECK("payment_deposit"."slip_number" IS NULL OR length(trim("payment_deposit"."slip_number")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_deposit_entry_unique_index` ON `payment_deposit` (`entry_id`);--> statement-breakpoint
CREATE INDEX `payment_deposit_deposited_on_index` ON `payment_deposit` (`deposited_on`);--> statement-breakpoint
CREATE TABLE `payment_deposit_fee` (
	`id` text PRIMARY KEY NOT NULL,
	`deposit_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`deposit_id`) REFERENCES `payment_deposit`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_deposit_fee_amount_check" CHECK("payment_deposit_fee"."amount_minor" > 0),
	CONSTRAINT "payment_deposit_fee_description_check" CHECK(length(trim("payment_deposit_fee"."description")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_deposit_fee_line_unique_index` ON `payment_deposit_fee` (`deposit_id`,`line_number`);--> statement-breakpoint
CREATE TABLE `payment_deposit_file` (
	`id` text PRIMARY KEY NOT NULL,
	`deposit_id` text NOT NULL,
	`receipt_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`removes_file_id` text,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`deposit_id`) REFERENCES `payment_deposit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipt`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_deposit_file_kind_check" CHECK("payment_deposit_file"."kind" IN ('scan', 'file')),
	CONSTRAINT "payment_deposit_file_name_check" CHECK(length("payment_deposit_file"."name") > 0),
	CONSTRAINT "payment_deposit_file_size_check" CHECK("payment_deposit_file"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `payment_deposit_file_deposit_index` ON `payment_deposit_file` (`deposit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_deposit_file_removes_unique_index` ON `payment_deposit_file` (`removes_file_id`);--> statement-breakpoint
CREATE TABLE `payment_deposit_note` (
	`id` text PRIMARY KEY NOT NULL,
	`deposit_id` text NOT NULL,
	`receipt_id` text,
	`body` text NOT NULL,
	`written_by` text,
	`written_at` text NOT NULL,
	FOREIGN KEY (`deposit_id`) REFERENCES `payment_deposit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipt`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_deposit_note_body_check" CHECK(length(trim("payment_deposit_note"."body")) > 0)
);
--> statement-breakpoint
CREATE INDEX `payment_deposit_note_deposit_index` ON `payment_deposit_note` (`deposit_id`);--> statement-breakpoint
CREATE TABLE `payment_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`deposit_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`application_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`received_from` text NOT NULL,
	`memo` text,
	`details` text NOT NULL,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`deposit_id`) REFERENCES `payment_deposit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `invoice_application`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_receipt_method_check" CHECK("payment_receipt"."method" IN ('check', 'cashiers_check', 'money_order', 'cash', 'ach', 'wire', 'card', 'payment_app', 'other')),
	CONSTRAINT "payment_receipt_reference_check" CHECK(("payment_receipt"."reference" IS NULL AND "payment_receipt"."method" IN ('cash', 'other')) OR length(trim("payment_receipt"."reference")) > 0),
	CONSTRAINT "payment_receipt_received_from_check" CHECK(length(trim("payment_receipt"."received_from")) > 0),
	CONSTRAINT "payment_receipt_line_number_check" CHECK("payment_receipt"."line_number" >= 1),
	CONSTRAINT "payment_receipt_details_check" CHECK(json_valid("payment_receipt"."details") AND json_type("payment_receipt"."details") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipt_application_unique_index` ON `payment_receipt` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipt_deposit_line_unique_index` ON `payment_receipt` (`deposit_id`,`line_number`);--> statement-breakpoint
CREATE TRIGGER `payment_deposit_no_update` BEFORE UPDATE ON `payment_deposit` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit is append-only; a deposit recorded in error is undone by reversing it, never by restating it');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_no_delete` BEFORE DELETE ON `payment_deposit` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit is append-only; payment records are kept');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_no_replace` BEFORE INSERT ON `payment_deposit` WHEN EXISTS (SELECT 1 FROM `payment_deposit` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'payment_deposit is append-only; an INSERT OR REPLACE would rewrite a recorded payment');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_no_update` BEFORE UPDATE ON `payment_receipt` BEGIN
  SELECT RAISE(ABORT, 'payment_receipt is append-only; a payment recorded in error is undone by reversing its application, never by restating the receipt');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_no_delete` BEFORE DELETE ON `payment_receipt` BEGIN
  SELECT RAISE(ABORT, 'payment_receipt is append-only; payment records are kept');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_no_replace` BEFORE INSERT ON `payment_receipt` WHEN EXISTS (SELECT 1 FROM `payment_receipt` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'payment_receipt is append-only; an INSERT OR REPLACE would rewrite a recorded payment');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_fee_no_update` BEFORE UPDATE ON `payment_deposit_fee` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_fee is append-only; a fee recorded in error is undone by reversing the deposit');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_fee_no_delete` BEFORE DELETE ON `payment_deposit_fee` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_fee is append-only; payment records are kept');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_fee_no_replace` BEFORE INSERT ON `payment_deposit_fee` WHEN EXISTS (SELECT 1 FROM `payment_deposit_fee` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_fee is append-only; an INSERT OR REPLACE would rewrite a recorded payment');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_note_no_update` BEFORE UPDATE ON `payment_deposit_note` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_note is append-only; a note is never edited; add another');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_note_no_delete` BEFORE DELETE ON `payment_deposit_note` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_note is append-only; payment records are kept');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_note_no_replace` BEFORE INSERT ON `payment_deposit_note` WHEN EXISTS (SELECT 1 FROM `payment_deposit_note` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_note is append-only; an INSERT OR REPLACE would rewrite a recorded payment');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_file_no_update` BEFORE UPDATE ON `payment_deposit_file` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_file is append-only; a file is taken off by a new row naming it, and the bytes are kept');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_file_no_delete` BEFORE DELETE ON `payment_deposit_file` BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_file is append-only; payment records are kept');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_file_no_replace` BEFORE INSERT ON `payment_deposit_file` WHEN EXISTS (SELECT 1 FROM `payment_deposit_file` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'payment_deposit_file is append-only; an INSERT OR REPLACE would rewrite a recorded payment');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_receipt_names_a_payment` BEFORE INSERT ON `payment_receipt`
WHEN NOT EXISTS (SELECT 1 FROM `invoice_application` WHERE `id` = NEW.`application_id` AND `kind` = 'payment') BEGIN
  SELECT RAISE(ABORT, 'a receipt stands beside the payment application it produced, never beside a transfer, a credit or a write-off');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_note_line_on_its_deposit` BEFORE INSERT ON `payment_deposit_note`
WHEN NEW.`receipt_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `payment_receipt` WHERE `id` = NEW.`receipt_id` AND `deposit_id` = NEW.`deposit_id`) BEGIN
  SELECT RAISE(ABORT, 'a note on a line is kept on that line''s own deposit');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_deposit_file_line_on_its_deposit` BEFORE INSERT ON `payment_deposit_file`
WHEN NEW.`receipt_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `payment_receipt` WHERE `id` = NEW.`receipt_id` AND `deposit_id` = NEW.`deposit_id`) BEGIN
  SELECT RAISE(ABORT, 'a file on a line is kept on that line''s own deposit');
END;
