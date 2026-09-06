-- TWO MORE STEP KINDS FOR THE INTAKE PROCEDURE: client-forms and payment.
--
-- A receptionist's intake has two steps the eight kinds could only spell as an acknowledgement:
-- sending the client the firm's online forms and getting them back, and the money that changes hands
-- before the firm acts (a consultation fee paid, or a payment the firm sends). Each is a member's
-- record today and a subsystem's answer the day the client portal and the payments port exist; the
-- reader behind a kind is registered by the composition root, so naming the kind now is what lets
-- the subsystem answer it later with no change to a firm's procedures.
--
-- contract: intake_procedure_step is dropped after its rows are copied into a replacement. This is a
-- same-transaction table REBUILD, not a data removal — the copy is exhaustive (every column, no
-- predicate), the drop and the rename run inside the one migration transaction, and a failure at any
-- point rolls the whole thing back with the original table intact. It is the only way SQLite can
-- widen a CHECK constraint.
--
-- matter_intake_step_record.procedure_step_id carries a foreign key to intake_procedure_step.id,
-- which is why the file brackets the work in PRAGMA foreign_keys=OFF / ON. The copy preserves every
-- id verbatim and the replacement takes the original's name, so every record resolves to the same
-- step it resolved to before. Nothing is re-keyed.
--
-- Column comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_intake_procedure_step` (
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
	CONSTRAINT "intake_procedure_step_title_nonempty_check" CHECK(length("__new_intake_procedure_step"."title") > 0),
	CONSTRAINT "intake_procedure_step_kind_check" CHECK("__new_intake_procedure_step"."kind" IN ('conflicts-check', 'fee-agreement', 'engagement-letter', 'document', 'questionnaire', 'retainer', 'identity-verification', 'acknowledgement', 'client-forms', 'payment')),
	CONSTRAINT "intake_procedure_step_required_check" CHECK("__new_intake_procedure_step"."required" IN (0, 1)),
	CONSTRAINT "intake_procedure_step_active_check" CHECK("__new_intake_procedure_step"."active" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_intake_procedure_step`("id", "procedure_id", "kind", "title", "instructions", "required", "reference_id", "position", "active", "created_at", "updated_at") SELECT "id", "procedure_id", "kind", "title", "instructions", "required", "reference_id", "position", "active", "created_at", "updated_at" FROM `intake_procedure_step`;--> statement-breakpoint
DROP TABLE `intake_procedure_step`;--> statement-breakpoint
ALTER TABLE `__new_intake_procedure_step` RENAME TO `intake_procedure_step`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `intake_procedure_step_procedure_position_index` ON `intake_procedure_step` (`procedure_id`,`position`);