CREATE TABLE `trust_bank_reconciliation` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`currency` text NOT NULL,
	`start_date` text NOT NULL,
	`start_balance_minor` integer NOT NULL,
	`start_carried_over` integer NOT NULL,
	`started_by` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_by` text,
	`finished_at` text,
	`finished_end_date` text,
	`finished_end_balance_minor` integer,
	`finished_cleared_balance_minor` integer,
	`finished_deposited_minor` integer,
	`finished_withdrawn_minor` integer,
	`finished_difference_minor` integer,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_bank_reconciliation_currency_check" CHECK(length("trust_bank_reconciliation"."currency") = 3),
	CONSTRAINT "trust_bank_reconciliation_start_date_shape_check" CHECK("trust_bank_reconciliation"."start_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "trust_bank_reconciliation_end_date_shape_check" CHECK("trust_bank_reconciliation"."finished_end_date" IS NULL OR "trust_bank_reconciliation"."finished_end_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "trust_bank_reconciliation_carried_over_check" CHECK("trust_bank_reconciliation"."start_carried_over" IN (0, 1)),
	CONSTRAINT "trust_bank_reconciliation_finish_shape_check" CHECK(("trust_bank_reconciliation"."finished_at" IS NULL AND "trust_bank_reconciliation"."finished_by" IS NULL AND "trust_bank_reconciliation"."finished_end_date" IS NULL AND "trust_bank_reconciliation"."finished_end_balance_minor" IS NULL AND "trust_bank_reconciliation"."finished_cleared_balance_minor" IS NULL AND "trust_bank_reconciliation"."finished_deposited_minor" IS NULL AND "trust_bank_reconciliation"."finished_withdrawn_minor" IS NULL AND "trust_bank_reconciliation"."finished_difference_minor" IS NULL)
        OR ("trust_bank_reconciliation"."finished_at" IS NOT NULL AND "trust_bank_reconciliation"."finished_by" IS NOT NULL AND "trust_bank_reconciliation"."finished_end_date" >= "trust_bank_reconciliation"."start_date" AND "trust_bank_reconciliation"."finished_end_balance_minor" IS NOT NULL AND "trust_bank_reconciliation"."finished_cleared_balance_minor" IS NOT NULL AND "trust_bank_reconciliation"."finished_deposited_minor" >= 0 AND "trust_bank_reconciliation"."finished_withdrawn_minor" >= 0 AND "trust_bank_reconciliation"."finished_difference_minor" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_account_index` ON `trust_bank_reconciliation` (`trust_account_id`,`start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_bank_reconciliation_one_open_unique_index` ON `trust_bank_reconciliation` (`trust_account_id`) WHERE "trust_bank_reconciliation"."finished_at" IS NULL;--> statement-breakpoint
CREATE TABLE `trust_bank_reconciliation_change` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`entry_id` text,
	`interest_id` text,
	`end_date` text,
	`end_balance_minor` integer,
	`cause` text NOT NULL,
	`reverts_change_id` text,
	`restore_point_id` text,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_bank_reconciliation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interest_id`) REFERENCES `trust_bank_reconciliation_interest`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_bank_reconciliation_change_sequence_check" CHECK("trust_bank_reconciliation_change"."sequence" > 0),
	CONSTRAINT "trust_bank_reconciliation_change_kind_check" CHECK("trust_bank_reconciliation_change"."kind" IN ('cleared', 'uncleared', 'end_date', 'end_balance')),
	CONSTRAINT "trust_bank_reconciliation_change_cause_check" CHECK("trust_bank_reconciliation_change"."cause" IN ('edit', 'undo', 'redo', 'history', 'restore')),
	CONSTRAINT "trust_bank_reconciliation_change_end_date_shape_check" CHECK("trust_bank_reconciliation_change"."end_date" IS NULL OR "trust_bank_reconciliation_change"."end_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "trust_bank_reconciliation_change_shape_check" CHECK(("trust_bank_reconciliation_change"."kind" IN ('cleared', 'uncleared') AND (("trust_bank_reconciliation_change"."entry_id" IS NULL) <> ("trust_bank_reconciliation_change"."interest_id" IS NULL)) AND "trust_bank_reconciliation_change"."end_date" IS NULL AND "trust_bank_reconciliation_change"."end_balance_minor" IS NULL)
        OR ("trust_bank_reconciliation_change"."kind" = 'end_date' AND "trust_bank_reconciliation_change"."entry_id" IS NULL AND "trust_bank_reconciliation_change"."interest_id" IS NULL AND "trust_bank_reconciliation_change"."end_date" IS NOT NULL AND "trust_bank_reconciliation_change"."end_balance_minor" IS NULL)
        OR ("trust_bank_reconciliation_change"."kind" = 'end_balance' AND "trust_bank_reconciliation_change"."entry_id" IS NULL AND "trust_bank_reconciliation_change"."interest_id" IS NULL AND "trust_bank_reconciliation_change"."end_date" IS NULL AND "trust_bank_reconciliation_change"."end_balance_minor" IS NOT NULL)),
	CONSTRAINT "trust_bank_reconciliation_change_cause_shape_check" CHECK(("trust_bank_reconciliation_change"."cause" = 'edit' AND "trust_bank_reconciliation_change"."reverts_change_id" IS NULL AND "trust_bank_reconciliation_change"."restore_point_id" IS NULL)
        OR ("trust_bank_reconciliation_change"."cause" IN ('undo', 'redo', 'history') AND "trust_bank_reconciliation_change"."reverts_change_id" IS NOT NULL AND "trust_bank_reconciliation_change"."restore_point_id" IS NULL)
        OR ("trust_bank_reconciliation_change"."cause" = 'restore' AND "trust_bank_reconciliation_change"."reverts_change_id" IS NULL AND "trust_bank_reconciliation_change"."restore_point_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_bank_reconciliation_change_sequence_unique_index` ON `trust_bank_reconciliation_change` (`reconciliation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_change_entry_index` ON `trust_bank_reconciliation_change` (`reconciliation_id`,`entry_id`);--> statement-breakpoint
CREATE TABLE `trust_bank_reconciliation_cleared` (
	`reconciliation_id` text NOT NULL,
	`entry_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_bank_reconciliation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_cleared_reconciliation_index` ON `trust_bank_reconciliation_cleared` (`reconciliation_id`);--> statement-breakpoint
CREATE TABLE `trust_bank_reconciliation_file` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`removes_file_id` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_bank_reconciliation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_bank_reconciliation_file_name_check" CHECK(length("trust_bank_reconciliation_file"."name") > 0),
	CONSTRAINT "trust_bank_reconciliation_file_size_check" CHECK("trust_bank_reconciliation_file"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_file_reconciliation_index` ON `trust_bank_reconciliation_file` (`reconciliation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_bank_reconciliation_file_removes_unique_index` ON `trust_bank_reconciliation_file` (`removes_file_id`);--> statement-breakpoint
CREATE TABLE `trust_bank_reconciliation_interest` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`kind` text NOT NULL,
	`posted_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`description` text NOT NULL,
	`removes_interest_id` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_bank_reconciliation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_bank_reconciliation_interest_kind_check" CHECK("trust_bank_reconciliation_interest"."kind" IN ('credited', 'swept')),
	CONSTRAINT "trust_bank_reconciliation_interest_posted_on_shape_check" CHECK("trust_bank_reconciliation_interest"."posted_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "trust_bank_reconciliation_interest_amount_check" CHECK("trust_bank_reconciliation_interest"."amount_minor" > 0),
	CONSTRAINT "trust_bank_reconciliation_interest_description_check" CHECK(length("trust_bank_reconciliation_interest"."description") > 0)
);
--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_interest_reconciliation_index` ON `trust_bank_reconciliation_interest` (`reconciliation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trust_bank_reconciliation_interest_removes_unique_index` ON `trust_bank_reconciliation_interest` (`removes_interest_id`);--> statement-breakpoint
CREATE TABLE `trust_bank_reconciliation_note` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`entry_id` text,
	`interest_id` text,
	`kind` text NOT NULL,
	`body` text,
	`written_by` text NOT NULL,
	`written_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_bank_reconciliation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interest_id`) REFERENCES `trust_bank_reconciliation_interest`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_bank_reconciliation_note_kind_check" CHECK("trust_bank_reconciliation_note"."kind" IN ('note', 'needs_review', 'resolved')),
	CONSTRAINT "trust_bank_reconciliation_note_line_check" CHECK(("trust_bank_reconciliation_note"."entry_id" IS NULL) <> ("trust_bank_reconciliation_note"."interest_id" IS NULL)),
	CONSTRAINT "trust_bank_reconciliation_note_body_check" CHECK(("trust_bank_reconciliation_note"."kind" = 'note' AND length("trust_bank_reconciliation_note"."body") > 0) OR ("trust_bank_reconciliation_note"."kind" <> 'note' AND "trust_bank_reconciliation_note"."body" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_note_reconciliation_index` ON `trust_bank_reconciliation_note` (`reconciliation_id`);--> statement-breakpoint
CREATE TABLE `trust_bank_reconciliation_restore_point` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`name` text NOT NULL,
	`at_sequence` integer NOT NULL,
	`automatic` integer NOT NULL,
	`saved_by` text NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `trust_bank_reconciliation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_bank_reconciliation_restore_point_name_check" CHECK(length("trust_bank_reconciliation_restore_point"."name") > 0),
	CONSTRAINT "trust_bank_reconciliation_restore_point_sequence_check" CHECK("trust_bank_reconciliation_restore_point"."at_sequence" >= 0),
	CONSTRAINT "trust_bank_reconciliation_restore_point_automatic_check" CHECK("trust_bank_reconciliation_restore_point"."automatic" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `trust_bank_reconciliation_restore_point_reconciliation_index` ON `trust_bank_reconciliation_restore_point` (`reconciliation_id`);--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_no_delete` BEFORE DELETE ON `trust_bank_reconciliation` BEGIN
  SELECT RAISE(ABORT, 'a trust bank reconciliation is kept');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_finish_only` BEFORE UPDATE ON `trust_bank_reconciliation`
WHEN OLD.`finished_at` IS NOT NULL
  OR NEW.`finished_at` IS NULL
  OR NEW.`id` <> OLD.`id`
  OR NEW.`trust_account_id` <> OLD.`trust_account_id`
  OR NEW.`currency` <> OLD.`currency`
  OR NEW.`start_date` <> OLD.`start_date`
  OR NEW.`start_balance_minor` <> OLD.`start_balance_minor`
  OR NEW.`start_carried_over` <> OLD.`start_carried_over`
  OR NEW.`started_by` <> OLD.`started_by`
  OR NEW.`started_at` <> OLD.`started_at`
BEGIN
  SELECT RAISE(ABORT, 'a trust bank reconciliation changes once, when it is finished');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_change_no_update` BEFORE UPDATE ON `trust_bank_reconciliation_change` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_change is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_change_no_delete` BEFORE DELETE ON `trust_bank_reconciliation_change` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_change is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_change_while_open` BEFORE INSERT ON `trust_bank_reconciliation_change`
WHEN (SELECT `finished_at` FROM `trust_bank_reconciliation` WHERE `id` = NEW.`reconciliation_id`) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'this reconciliation is finished');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_change_dense_sequence` BEFORE INSERT ON `trust_bank_reconciliation_change`
WHEN NEW.`sequence` <> 1 + COALESCE((SELECT MAX(`sequence`) FROM `trust_bank_reconciliation_change` WHERE `reconciliation_id` = NEW.`reconciliation_id`), 0)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation change follows the last one');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_change_entry_on_account` BEFORE INSERT ON `trust_bank_reconciliation_change`
WHEN NEW.`entry_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `ledger_line` l
    JOIN `trust_account` a ON a.`bank_ledger_account_id` = l.`account_id`
    JOIN `trust_bank_reconciliation` r ON r.`trust_account_id` = a.`id`
   WHERE l.`entry_id` = NEW.`entry_id` AND r.`id` = NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation ticks an item that moved this trust account''s bank balance');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_change_same_period` BEFORE INSERT ON `trust_bank_reconciliation_change`
WHEN (NEW.`interest_id` IS NOT NULL AND (SELECT `reconciliation_id` FROM `trust_bank_reconciliation_interest` WHERE `id` = NEW.`interest_id`) IS NOT NEW.`reconciliation_id`)
  OR (NEW.`reverts_change_id` IS NOT NULL AND (SELECT `reconciliation_id` FROM `trust_bank_reconciliation_change` WHERE `id` = NEW.`reverts_change_id`) IS NOT NEW.`reconciliation_id`)
  OR (NEW.`restore_point_id` IS NOT NULL AND (SELECT `reconciliation_id` FROM `trust_bank_reconciliation_restore_point` WHERE `id` = NEW.`restore_point_id`) IS NOT NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation change names things in its own reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_interest_no_update` BEFORE UPDATE ON `trust_bank_reconciliation_interest` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_interest is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_interest_no_delete` BEFORE DELETE ON `trust_bank_reconciliation_interest` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_interest is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_interest_while_open` BEFORE INSERT ON `trust_bank_reconciliation_interest`
WHEN (SELECT `finished_at` FROM `trust_bank_reconciliation` WHERE `id` = NEW.`reconciliation_id`) IS NOT NULL
  OR (NEW.`removes_interest_id` IS NOT NULL AND (SELECT `reconciliation_id` FROM `trust_bank_reconciliation_interest` WHERE `id` = NEW.`removes_interest_id` AND `removes_interest_id` IS NULL) IS NOT NEW.`reconciliation_id`)
BEGIN
  SELECT RAISE(ABORT, 'interest is added to or removed from a reconciliation in progress');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_restore_point_no_update` BEFORE UPDATE ON `trust_bank_reconciliation_restore_point` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_restore_point is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_restore_point_no_delete` BEFORE DELETE ON `trust_bank_reconciliation_restore_point` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_restore_point is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_restore_point_while_open` BEFORE INSERT ON `trust_bank_reconciliation_restore_point`
WHEN (SELECT `finished_at` FROM `trust_bank_reconciliation` WHERE `id` = NEW.`reconciliation_id`) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'this reconciliation is finished');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_note_no_update` BEFORE UPDATE ON `trust_bank_reconciliation_note` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_note is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_note_no_delete` BEFORE DELETE ON `trust_bank_reconciliation_note` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_note is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_note_same_period` BEFORE INSERT ON `trust_bank_reconciliation_note`
WHEN (NEW.`interest_id` IS NOT NULL AND (SELECT `reconciliation_id` FROM `trust_bank_reconciliation_interest` WHERE `id` = NEW.`interest_id`) IS NOT NEW.`reconciliation_id`)
  OR (NEW.`entry_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `ledger_line` l
      JOIN `trust_account` a ON a.`bank_ledger_account_id` = l.`account_id`
      JOIN `trust_bank_reconciliation` r ON r.`trust_account_id` = a.`id`
     WHERE l.`entry_id` = NEW.`entry_id` AND r.`id` = NEW.`reconciliation_id`))
BEGIN
  SELECT RAISE(ABORT, 'a reconciliation note is about a line of that reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_file_no_update` BEFORE UPDATE ON `trust_bank_reconciliation_file` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_file is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_file_no_delete` BEFORE DELETE ON `trust_bank_reconciliation_file` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_file is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_file_removes_same_period` BEFORE INSERT ON `trust_bank_reconciliation_file`
WHEN NEW.`removes_file_id` IS NOT NULL AND (SELECT `reconciliation_id` FROM `trust_bank_reconciliation_file` WHERE `id` = NEW.`removes_file_id` AND `removes_file_id` IS NULL) IS NOT NEW.`reconciliation_id`
BEGIN
  SELECT RAISE(ABORT, 'a file is removed from the reconciliation it was kept with');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_cleared_no_update` BEFORE UPDATE ON `trust_bank_reconciliation_cleared` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_cleared is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_cleared_no_delete` BEFORE DELETE ON `trust_bank_reconciliation_cleared` BEGIN
  SELECT RAISE(ABORT, 'trust_bank_reconciliation_cleared is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_bank_reconciliation_cleared_at_finish` BEFORE INSERT ON `trust_bank_reconciliation_cleared`
WHEN (SELECT `finished_at` FROM `trust_bank_reconciliation` WHERE `id` = NEW.`reconciliation_id`) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'cleared items are written when a reconciliation is finished');
END;
