-- THE INTAKE PROCEDURE: three tables and four permission seeds.
--
-- A procedure is a firm's own list of what a kind of matter must clear before it opens — the
-- conflicts check, the fee agreement, the engagement letter, the retainer, a questionnaire, a
-- verification of who the client is — bound to a matter type or to every kind. It gates the opening
-- the way the matter plan proposes the work that follows it, and the two stay separate records because
-- they answer different questions.
--
-- A step's KIND decides who answers it. The kinds with a subsystem behind them are answered by that
-- subsystem at the moment of reading (the conflicts posture, the billing arrangement in force, an
-- assembly of the referenced template, the matter's trust position, a custom field's current value);
-- the kinds without one are answered by a member's record, and every kind also accepts a member's
-- record, because a signed letter that came back on paper is a fact the platform did not see. The
-- reader behind each kind is registered by the composition root, not by this schema, so a kind may
-- exist here ahead of the subsystem that will one day answer it. The vocabulary is a CHECK so a new
-- kind is a reviewed migration.
--
-- THE PLATFORM SEEDS NO PROCEDURE. This migration creates the tables and inserts no rows into them,
-- on the matter plan's argument: a procedure is a statement about how THIS firm practises, and one
-- shipped with a missing step would be trusted precisely because it shipped.
--
-- A member's answer to a step is APPEND-AND-FLIP: reopening stamps superseded_at on the live record
-- and the next answer is a new row, so an ethics gate's history keeps every answer it was given. The
-- partial unique index holds one live record per step per matter. A waiver must carry its rationale.
--
-- Additive throughout: three creates and their indexes, no rebuild.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
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
CREATE INDEX `intake_procedure_matter_type_active_index` ON `intake_procedure` (`matter_type_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `intake_procedure_name_unique_index` ON `intake_procedure` (`name`);--> statement-breakpoint
CREATE TABLE `intake_procedure_step` (
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
	CONSTRAINT "intake_procedure_step_kind_check" CHECK("intake_procedure_step"."kind" IN ('conflicts-check', 'fee-agreement', 'engagement-letter', 'document', 'questionnaire', 'retainer', 'identity-verification', 'acknowledgement')),
	CONSTRAINT "intake_procedure_step_required_check" CHECK("intake_procedure_step"."required" IN (0, 1)),
	CONSTRAINT "intake_procedure_step_active_check" CHECK("intake_procedure_step"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `intake_procedure_step_procedure_position_index` ON `intake_procedure_step` (`procedure_id`,`position`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `matter_intake_step_record_live_unique_index` ON `matter_intake_step_record` (`matter_id`,`procedure_step_id`) WHERE "matter_intake_step_record"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX `matter_intake_step_record_matter_index` ON `matter_intake_step_record` (`matter_id`,`recorded_at`);--> statement-breakpoint

-- The four intake keys, seeded on the tasks split.
--
-- intake:read and intake:record reach every seat that does firm work — Owner/Admin, Attorney,
-- Paralegal and Billing — because the retainer arriving and the fee being agreed are a billing
-- clerk's own facts to record, and a checklist a clerk cannot mark sends them to a sticky note.
-- Read-only carries neither: it carries no write anywhere, and the checklist is a working surface.
--
-- intake:waive stops at Owner/Admin and Attorney. Waiving a required step is the recorded override of
-- an opening gate, under a named member's rationale, and the seats that may take a matter on over an
-- unmet requirement are the seats that answer for it.
--
-- intake:manageProcedures stops at the same two, on tasks:managePlans's argument: the procedure is the
-- firm's statement of how it takes work on, and a wrong step propagates to every consultation of that
-- kind.
--
-- Each rolePermission_ handle is minted once and committed as a literal; the role_id values are the
-- five seeded roles from the baseline's member-rbac seed.

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
