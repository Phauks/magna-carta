CREATE TABLE `trust_check` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`check_number` integer NOT NULL,
	`movement_id` text,
	`stock_id` text,
	`payee` text,
	`amount_minor` integer,
	`currency` text,
	`effective_date` text,
	`numbered_by` text NOT NULL,
	`numbered_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movement_id`) REFERENCES `trust_movement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`) REFERENCES `trust_check_stock`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_check_number_positive_check" CHECK("trust_check"."check_number" > 0),
	CONSTRAINT "trust_check_effective_date_shape_check" CHECK("trust_check"."effective_date" IS NULL OR "trust_check"."effective_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "trust_check_shape_check" CHECK(("trust_check"."movement_id" IS NOT NULL AND "trust_check"."payee" IS NOT NULL AND "trust_check"."amount_minor" > 0 AND length("trust_check"."currency") = 3 AND "trust_check"."effective_date" IS NOT NULL)
        OR ("trust_check"."movement_id" IS NULL AND "trust_check"."payee" IS NULL AND "trust_check"."amount_minor" IS NULL AND "trust_check"."currency" IS NULL AND "trust_check"."effective_date" IS NULL AND "trust_check"."stock_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_check_account_number_unique_index` ON `trust_check` (`trust_account_id`,`check_number`);--> statement-breakpoint
CREATE INDEX `trust_check_movement_index` ON `trust_check` (`movement_id`);--> statement-breakpoint
CREATE TABLE `trust_check_event` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `trust_check`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_check_event_kind_check" CHECK("trust_check_event"."kind" IN ('printed', 'spoiled', 'voided')),
	CONSTRAINT "trust_check_event_reason_check" CHECK("trust_check_event"."kind" = 'printed' OR length("trust_check_event"."reason") > 0)
);
--> statement-breakpoint
CREATE INDEX `trust_check_event_check_index` ON `trust_check_event` (`check_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `trust_check_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_account_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`page_layout` text NOT NULL,
	`fields` text NOT NULL,
	`shift_x_mils` integer DEFAULT 0 NOT NULL,
	`shift_y_mils` integer DEFAULT 0 NOT NULL,
	`starting_check_number` integer NOT NULL,
	`scan_object_key` text,
	`scan_sha256` text,
	`saved_by` text NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`trust_account_id`) REFERENCES `trust_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trust_check_stock_version_positive_check" CHECK("trust_check_stock"."version" > 0),
	CONSTRAINT "trust_check_stock_name_nonempty_check" CHECK(length("trust_check_stock"."name") > 0),
	CONSTRAINT "trust_check_stock_page_layout_check" CHECK("trust_check_stock"."page_layout" IN ('check_top', 'check_middle', 'check_bottom', 'three_per_page')),
	CONSTRAINT "trust_check_stock_starting_number_check" CHECK("trust_check_stock"."starting_check_number" > 0),
	CONSTRAINT "trust_check_stock_scan_together_check" CHECK(("trust_check_stock"."scan_object_key" IS NULL) = ("trust_check_stock"."scan_sha256" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trust_check_stock_account_version_unique_index` ON `trust_check_stock` (`trust_account_id`,`version`);--> statement-breakpoint
CREATE TRIGGER `trust_check_stock_no_update` BEFORE UPDATE ON `trust_check_stock` BEGIN
  SELECT RAISE(ABORT, 'trust_check_stock is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_stock_no_delete` BEFORE DELETE ON `trust_check_stock` BEGIN
  SELECT RAISE(ABORT, 'trust_check_stock is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_stock_dense_version` BEFORE INSERT ON `trust_check_stock` WHEN NEW.`version` <> 1 + COALESCE((SELECT MAX(`version`) FROM `trust_check_stock` WHERE `trust_account_id` = NEW.`trust_account_id`), 0) BEGIN
  SELECT RAISE(ABORT, 'a check stock version follows the last one');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_no_update` BEFORE UPDATE ON `trust_check` BEGIN
  SELECT RAISE(ABORT, 'trust_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_no_delete` BEFORE DELETE ON `trust_check` BEGIN
  SELECT RAISE(ABORT, 'trust_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_pays_a_check_disbursement` BEFORE INSERT ON `trust_check` WHEN NEW.`movement_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `trust_movement` WHERE `id` = NEW.`movement_id` AND `trust_account_id` = NEW.`trust_account_id` AND `kind` = 'disbursement' AND `method` = 'check') BEGIN
  SELECT RAISE(ABORT, 'a trust check pays a check disbursement on its own account');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_stock_on_its_account` BEFORE INSERT ON `trust_check` WHEN NEW.`stock_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `trust_check_stock` WHERE `id` = NEW.`stock_id` AND `trust_account_id` = NEW.`trust_account_id`) BEGIN
  SELECT RAISE(ABORT, 'a trust check prints on its own account''s stock');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_event_no_update` BEFORE UPDATE ON `trust_check_event` BEGIN
  SELECT RAISE(ABORT, 'trust_check_event is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_event_no_delete` BEFORE DELETE ON `trust_check_event` BEGIN
  SELECT RAISE(ABORT, 'trust_check_event is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trust_check_event_sequence` BEFORE INSERT ON `trust_check_event` WHEN EXISTS (SELECT 1 FROM `trust_check_event` WHERE `check_id` = NEW.`check_id` AND (`kind` <> 'printed' OR NEW.`kind` <> 'voided')) BEGIN
  SELECT RAISE(ABORT, 'a trust check has already been settled');
END;
