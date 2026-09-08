CREATE TABLE `intake_form` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`introduction` text,
	`confirmation_message` text,
	`public_token` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_version_id` text,
	`submission_budget_per_day` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "intake_form_name_nonempty_check" CHECK(length("intake_form"."name") > 0),
	CONSTRAINT "intake_form_title_nonempty_check" CHECK(length("intake_form"."title") > 0),
	CONSTRAINT "intake_form_public_token_nonempty_check" CHECK(length("intake_form"."public_token") > 0),
	CONSTRAINT "intake_form_status_check" CHECK("intake_form"."status" IN ('draft', 'published', 'closed')),
	CONSTRAINT "intake_form_published_version_check" CHECK("intake_form"."status" <> 'published' OR "intake_form"."published_version_id" IS NOT NULL),
	CONSTRAINT "intake_form_submission_budget_check" CHECK("intake_form"."submission_budget_per_day" IS NULL OR "intake_form"."submission_budget_per_day" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_form_public_token_unique_index` ON `intake_form` (`public_token`);--> statement-breakpoint
CREATE INDEX `intake_form_status_index` ON `intake_form` (`status`);--> statement-breakpoint
CREATE TABLE `intake_form_field` (
	`id` text PRIMARY KEY NOT NULL,
	`form_version_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`required` integer DEFAULT 0 NOT NULL,
	`options_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`form_version_id`) REFERENCES `intake_form_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_form_field_label_nonempty_check" CHECK(length("intake_form_field"."label") > 0),
	CONSTRAINT "intake_form_field_kind_check" CHECK("intake_form_field"."kind" IN ('person-name', 'organization-name', 'email', 'telephone', 'postal-address', 'matter-description', 'choice', 'question')),
	CONSTRAINT "intake_form_field_required_check" CHECK("intake_form_field"."required" IN (0, 1)),
	CONSTRAINT "intake_form_field_options_kind_check" CHECK(("intake_form_field"."kind" = 'choice') = ("intake_form_field"."options_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `intake_form_field_version_position_index` ON `intake_form_field` (`form_version_id`,`position`);--> statement-breakpoint
CREATE TABLE `intake_form_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`form_version_id` text NOT NULL,
	`submitted_at` text NOT NULL,
	`answers_json` text NOT NULL,
	`source` text DEFAULT 'public_form' NOT NULL,
	`accepted_entity_id` text,
	`accepted_matter_id` text,
	`triage_state` text DEFAULT 'new' NOT NULL,
	`triaged_at` text,
	`triaged_by` text,
	`triage_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`form_version_id`) REFERENCES `intake_form_version`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_form_submission_triage_state_check" CHECK("intake_form_submission"."triage_state" IN ('new', 'accepted', 'declined', 'spam')),
	CONSTRAINT "intake_form_submission_triage_shape_check" CHECK(("intake_form_submission"."triage_state" = 'new') = ("intake_form_submission"."triaged_at" IS NULL)
        AND ("intake_form_submission"."triaged_at" IS NULL) = ("intake_form_submission"."triaged_by" IS NULL)),
	CONSTRAINT "intake_form_submission_accepted_shape_check" CHECK(("intake_form_submission"."accepted_entity_id" IS NULL) = ("intake_form_submission"."accepted_matter_id" IS NULL)),
	CONSTRAINT "intake_form_submission_accepted_state_check" CHECK("intake_form_submission"."accepted_entity_id" IS NULL OR "intake_form_submission"."triage_state" = 'accepted'),
	CONSTRAINT "intake_form_submission_source_nonempty_check" CHECK(length("intake_form_submission"."source") > 0)
);
--> statement-breakpoint
CREATE INDEX `intake_form_submission_version_submitted_index` ON `intake_form_submission` (`form_version_id`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `intake_form_submission_state_submitted_index` ON `intake_form_submission` (`triage_state`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `intake_form_version` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`published_at` text,
	`published_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `intake_form`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_form_version_number_check" CHECK("intake_form_version"."version_number" > 0),
	CONSTRAINT "intake_form_version_published_shape_check" CHECK(("intake_form_version"."published_at" IS NULL) = ("intake_form_version"."published_by" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_form_version_form_number_unique_index` ON `intake_form_version` (`form_id`,`version_number`);--> statement-breakpoint
-- The two public-intake-form permissions, seeded onto the default roles.
--
-- intakeForms:manage is Owner/Admin ONLY. Authoring a public form is the firm deciding what it asks
-- strangers and where its public link points; publishing one puts a page on the open internet under
-- the firm's name, and rotating its token silently breaks every link already handed out. That is the
-- firm's own act, on the same reasoning that stops intake:manageProcedures at the seats that decide
-- how the firm takes work on.
--
-- intakeForms:readSubmissions reaches Owner/Admin, Attorney and Paralegal. Clearing the queue is
-- reception's daily job and the paralegal seat is where reception usually sits, so withholding it
-- would mean the queue could only be worked by a partner. Billing gets nothing: a submission is a
-- stranger's account of their problem, before the firm has decided whether it wants the work, and
-- there is no billing question it answers. Read-only gets nothing either, on the notes reasoning —
-- that seat is frequently an outside accountant or an auditor.
--
-- Each rolePermission_ handle is minted once and committed as a literal. The role_id values are the
-- seeded roles from the baseline's member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_mkICk5W1Iwh5DYKgWd33F', 'role_Gw-zKO8hOHQuNv2bWokMp', 'intakeForms:manage');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_FIKDSfxB9iad-DMAG-uxs', 'role_Gw-zKO8hOHQuNv2bWokMp', 'intakeForms:readSubmissions');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_ku0rip3XtDT8PwdbkN72o', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'intakeForms:readSubmissions');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_HSQVn64wQfCg00-G-jciD', 'role_917LCQyRKP50Z9bW89vXl', 'intakeForms:readSubmissions');
