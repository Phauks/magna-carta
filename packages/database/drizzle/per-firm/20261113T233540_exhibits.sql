CREATE TABLE `exhibit_reference` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_version_id` text NOT NULL,
	`matter_exhibit_id` text NOT NULL,
	`occurrence_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_exhibit_id`) REFERENCES `matter_exhibit`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exhibit_reference_occurrence_check" CHECK("exhibit_reference"."occurrence_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX `exhibit_reference_matter_exhibit_index` ON `exhibit_reference` (`matter_id`,`matter_exhibit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exhibit_reference_version_exhibit_unique_index` ON `exhibit_reference` (`file_version_id`,`matter_exhibit_id`);--> statement-breakpoint
CREATE TABLE `exhibit_set` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`name` text NOT NULL,
	`noun` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`sequence` text NOT NULL,
	`start_at` integer NOT NULL,
	`overflow_form` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`continues_from_set_id` text,
	`supersedes_set_id` text,
	`disposition` text,
	`issued_on` text,
	`issued_at` text,
	`issued_by` text,
	`filed_copy_file_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`continues_from_set_id`) REFERENCES `exhibit_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_set_id`) REFERENCES `exhibit_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filed_copy_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exhibit_set_sequence_check" CHECK("exhibit_set"."sequence" IN ('upperLetter', 'lowerLetter', 'arabic', 'upperRoman', 'lowerRoman')),
	CONSTRAINT "exhibit_set_overflow_form_check" CHECK("exhibit_set"."overflow_form" IN ('doubled', 'bijective')),
	CONSTRAINT "exhibit_set_state_check" CHECK("exhibit_set"."state" IN ('draft', 'issued')),
	CONSTRAINT "exhibit_set_disposition_check" CHECK("exhibit_set"."disposition" IS NULL OR "exhibit_set"."disposition" IN ('filed', 'served', 'exchanged', 'lodged')),
	CONSTRAINT "exhibit_set_shape_check" CHECK(length("exhibit_set"."name") > 0 AND "exhibit_set"."start_at" >= 1),
	CONSTRAINT "exhibit_set_issue_shape_check" CHECK(("exhibit_set"."state" = 'issued') = ("exhibit_set"."disposition" IS NOT NULL AND "exhibit_set"."issued_on" IS NOT NULL AND "exhibit_set"."issued_at" IS NOT NULL) AND ("exhibit_set"."state" = 'issued' OR "exhibit_set"."issued_by" IS NULL)),
	CONSTRAINT "exhibit_set_issued_on_shape_check" CHECK("exhibit_set"."issued_on" IS NULL OR "exhibit_set"."issued_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "exhibit_set_not_its_own_predecessor_check" CHECK(("exhibit_set"."supersedes_set_id" IS NULL OR "exhibit_set"."supersedes_set_id" <> "exhibit_set"."id") AND ("exhibit_set"."continues_from_set_id" IS NULL OR "exhibit_set"."continues_from_set_id" <> "exhibit_set"."id"))
);
--> statement-breakpoint
CREATE INDEX `exhibit_set_matter_state_index` ON `exhibit_set` (`matter_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `exhibit_set_supersedes_unique_index` ON `exhibit_set` (`supersedes_set_id`) WHERE "exhibit_set"."supersedes_set_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `exhibit_set_continues_from_index` ON `exhibit_set` (`continues_from_set_id`);--> statement-breakpoint
CREATE TABLE `exhibit_set_member` (
	`id` text PRIMARY KEY NOT NULL,
	`exhibit_set_id` text NOT NULL,
	`matter_exhibit_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text,
	`title_as_issued` text,
	`file_version_id_as_issued` text,
	`status` text DEFAULT 'active' NOT NULL,
	`withdrawn_at` text,
	`withdrawn_by` text,
	`withdrawal_basis` text,
	`corrected_title` text,
	`corrected_file_version_id` text,
	`corrected_at` text,
	`corrected_by` text,
	`correction_basis` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`exhibit_set_id`) REFERENCES `exhibit_set`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_exhibit_id`) REFERENCES `matter_exhibit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id_as_issued`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrected_file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exhibit_set_member_status_check" CHECK("exhibit_set_member"."status" IN ('active', 'withdrawn')),
	CONSTRAINT "exhibit_set_member_position_check" CHECK("exhibit_set_member"."position" <> 0),
	CONSTRAINT "exhibit_set_member_withdrawal_shape_check" CHECK(("exhibit_set_member"."status" = 'withdrawn') = ("exhibit_set_member"."withdrawn_at" IS NOT NULL)),
	CONSTRAINT "exhibit_set_member_issue_shape_check" CHECK(("exhibit_set_member"."label" IS NULL) = ("exhibit_set_member"."title_as_issued" IS NULL) AND ("exhibit_set_member"."status" = 'active' OR "exhibit_set_member"."label" IS NOT NULL)),
	CONSTRAINT "exhibit_set_member_correction_shape_check" CHECK(("exhibit_set_member"."corrected_at" IS NULL) = ("exhibit_set_member"."corrected_by" IS NULL) AND ("exhibit_set_member"."corrected_at" IS NOT NULL OR ("exhibit_set_member"."corrected_title" IS NULL AND "exhibit_set_member"."corrected_file_version_id" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exhibit_set_member_position_unique_index` ON `exhibit_set_member` (`exhibit_set_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `exhibit_set_member_label_unique_index` ON `exhibit_set_member` (`exhibit_set_id`,`label`) WHERE "exhibit_set_member"."label" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `exhibit_set_member_exhibit_unique_index` ON `exhibit_set_member` (`exhibit_set_id`,`matter_exhibit_id`);--> statement-breakpoint
CREATE INDEX `exhibit_set_member_exhibit_index` ON `exhibit_set_member` (`matter_exhibit_id`);--> statement-breakpoint
CREATE TABLE `matter_exhibit` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`reference_name` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source_kind` text NOT NULL,
	`file_id` text NOT NULL,
	`pinned_file_version_id` text,
	`page_count` integer,
	`bates_begin` text,
	`bates_end` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`matter_id`) REFERENCES `matter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pinned_file_version_id`) REFERENCES `file_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matter_exhibit_source_kind_check" CHECK("matter_exhibit"."source_kind" IN ('matterFile', 'assembledDocument', 'custodyItemScan', 'discoveryDocument')),
	CONSTRAINT "matter_exhibit_shape_check" CHECK(length("matter_exhibit"."title") > 0 AND length("matter_exhibit"."reference_name") > 0 AND ("matter_exhibit"."page_count" IS NULL OR "matter_exhibit"."page_count" >= 0)),
	CONSTRAINT "matter_exhibit_bates_shape_check" CHECK(("matter_exhibit"."bates_begin" IS NULL) = ("matter_exhibit"."bates_end" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_exhibit_reference_name_unique_index` ON `matter_exhibit` (`matter_id`,`reference_name`);--> statement-breakpoint
CREATE INDEX `matter_exhibit_matter_index` ON `matter_exhibit` (`matter_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `matter_exhibit_file_index` ON `matter_exhibit` (`file_id`);--> statement-breakpoint
-- AN ISSUED SET IS THE RECORD OF WHAT WENT OUT, AND THE DATABASE REFUSES TO CHANGE IT.
--
-- The issue batch writes every member's label, title_as_issued and file_version_id_as_issued while
-- the set is still a draft, and only then flips exhibit_set.state. From that moment these triggers
-- refuse a new member, a removed member, and any change to a member's label, position, set or
-- exhibit, or to the values recorded at issue. Withdrawal and correction write only their own
-- columns. The set itself may never leave 'issued', and its scheme, name and issue facts are fixed;
-- the court-stamped copy may be attached later, once, because it often arrives days after filing.
CREATE TRIGGER `exhibit_set_member_no_insert_after_issue` BEFORE INSERT ON `exhibit_set_member` WHEN (SELECT `state` FROM `exhibit_set` WHERE `id` = NEW.`exhibit_set_id`) = 'issued' BEGIN
  SELECT RAISE(ABORT, 'an issued exhibit set cannot gain a member; supersede it instead');
END;
--> statement-breakpoint
CREATE TRIGGER `exhibit_set_member_no_delete_after_issue` BEFORE DELETE ON `exhibit_set_member` WHEN (SELECT `state` FROM `exhibit_set` WHERE `id` = OLD.`exhibit_set_id`) = 'issued' BEGIN
  SELECT RAISE(ABORT, 'an issued exhibit set cannot lose a member; withdraw it instead');
END;
--> statement-breakpoint
CREATE TRIGGER `exhibit_set_member_frozen_after_issue` BEFORE UPDATE ON `exhibit_set_member` WHEN (SELECT `state` FROM `exhibit_set` WHERE `id` = OLD.`exhibit_set_id`) = 'issued' AND (OLD.`label` IS NOT NEW.`label` OR OLD.`position` IS NOT NEW.`position` OR OLD.`exhibit_set_id` IS NOT NEW.`exhibit_set_id` OR OLD.`matter_exhibit_id` IS NOT NEW.`matter_exhibit_id` OR OLD.`title_as_issued` IS NOT NEW.`title_as_issued` OR OLD.`file_version_id_as_issued` IS NOT NEW.`file_version_id_as_issued` OR (OLD.`status` = 'withdrawn' AND NEW.`status` <> 'withdrawn')) BEGIN
  SELECT RAISE(ABORT, 'an issued exhibit set member keeps the label, position and values it went out with');
END;
--> statement-breakpoint
CREATE TRIGGER `exhibit_set_frozen_after_issue` BEFORE UPDATE ON `exhibit_set` WHEN OLD.`state` = 'issued' AND (NEW.`state` IS NOT 'issued' OR OLD.`matter_id` IS NOT NEW.`matter_id` OR OLD.`name` IS NOT NEW.`name` OR OLD.`noun` IS NOT NEW.`noun` OR OLD.`prefix` IS NOT NEW.`prefix` OR OLD.`sequence` IS NOT NEW.`sequence` OR OLD.`start_at` IS NOT NEW.`start_at` OR OLD.`overflow_form` IS NOT NEW.`overflow_form` OR OLD.`continues_from_set_id` IS NOT NEW.`continues_from_set_id` OR OLD.`supersedes_set_id` IS NOT NEW.`supersedes_set_id` OR OLD.`disposition` IS NOT NEW.`disposition` OR OLD.`issued_on` IS NOT NEW.`issued_on` OR OLD.`issued_at` IS NOT NEW.`issued_at` OR OLD.`issued_by` IS NOT NEW.`issued_by` OR OLD.`archived_at` IS NOT NEW.`archived_at` OR (OLD.`filed_copy_file_id` IS NOT NULL AND OLD.`filed_copy_file_id` IS NOT NEW.`filed_copy_file_id`)) BEGIN
  SELECT RAISE(ABORT, 'an issued exhibit set cannot be changed or unissued; supersede it instead');
END;
--> statement-breakpoint
CREATE TRIGGER `exhibit_set_no_delete` BEFORE DELETE ON `exhibit_set` WHEN OLD.`state` = 'issued' BEGIN
  SELECT RAISE(ABORT, 'an issued exhibit set cannot be deleted');
END;
--> statement-breakpoint
-- A row records what an immutable document version cites, so it has nothing that could change.
CREATE TRIGGER `exhibit_reference_no_update` BEFORE UPDATE ON `exhibit_reference` BEGIN
  SELECT RAISE(ABORT, 'exhibit_reference rows are written once with the document version they describe');
END;
--> statement-breakpoint
-- THE TWO EXHIBIT KEYS GET SEATS.
--
-- exhibits:manage to the three practising seats: building and ordering a set is drafting work a
-- paralegal does every day. exhibits:issue to the same three by default, because the paralegal who
-- files the motion is usually the one who records that it was filed; the key is separate so a firm
-- that wants only attorneys to say a filing happened can take it away from the Paralegal seat
-- without touching the drafting work. The role ids are the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_exhibitsManageOwner0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'exhibits:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_exhibitsManageAttorn', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'exhibits:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_exhibitsManageParale', 'role_917LCQyRKP50Z9bW89vXl', 'exhibits:manage');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_exhibitsIssueOwner00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'exhibits:issue');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_exhibitsIssueAttorne', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'exhibits:issue');
--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_exhibitsIssueParaleg', 'role_917LCQyRKP50Z9bW89vXl', 'exhibits:issue');
