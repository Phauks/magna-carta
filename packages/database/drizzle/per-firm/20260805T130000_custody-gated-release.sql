-- Gated release: an original does not leave the firm's custody until identity and authority have
-- been captured. Hand-written rather than drizzle-kit-generated because the gate is enforced by
-- triggers, which drizzle-kit cannot model at all. Table and column comments live beside the Drizzle
-- definitions in packages/database/src/per-firm-schema.ts.
--
-- The capture rides the ledger row itself rather than a side table. A release is the movement whose
-- evidentiary value is highest and whose window is shortest: what matters is what was established
-- BEFORE the property left, and a side table that can be written afterwards, or edited, records
-- something else. custody_movement already carries the borrower and the due-back date the same way.
--
-- Deliberately absent, and not an oversight: any enumeration of what authority suffices to release an
-- original. A grant of probate, letters of administration, and the fact that a power of attorney dies
-- with its grantor are jurisdiction-specific, and a CHECK listing them would be this schema inventing
-- law. The basis is free text a firm writes, on the same footing as the ownership role.
ALTER TABLE `custody_movement` ADD COLUMN `release_authority_basis` text;--> statement-breakpoint
ALTER TABLE `custody_movement` ADD COLUMN `release_identity_evidence` text;--> statement-breakpoint
ALTER TABLE `custody_movement` ADD COLUMN `release_identity_verified_by_user_id` text;--> statement-breakpoint
ALTER TABLE `custody_movement` ADD COLUMN `release_witnessed_by_user_id` text;--> statement-breakpoint
-- The gate is a TRIGGER rather than a CHECK, and the difference is the whole point.
--
-- A CHECK is a property of the table, so adding one means rebuilding the table and re-copying every
-- existing row through it — and every release recorded before this migration was recorded honestly
-- under the rules that then applied, carrying no capture. Making those rows pass would mean writing a
-- basis nobody asserted into a ledger whose only claim is that nobody could do exactly that. A BEFORE
-- INSERT trigger binds every row appended from here on and leaves the record of what actually
-- happened alone, which is the only version of this gate a custody register can honestly enforce.
CREATE TRIGGER `custody_movement_release_gate` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` = 'released' AND (NEW.`release_authority_basis` IS NULL OR length(trim(NEW.`release_authority_basis`)) = 0 OR NEW.`release_identity_evidence` IS NULL OR length(trim(NEW.`release_identity_evidence`)) = 0 OR NEW.`release_identity_verified_by_user_id` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a custody release records the authority relied on and the identity check made before the property left');
END;
--> statement-breakpoint
-- Two signatories means two people. Whether the firm requires a second is a per-firm policy read at
-- the write path; that the second is a different person is structural, and mirrors the requester /
-- approver split the destruction request row already carries.
CREATE TRIGGER `custody_movement_release_witness_distinct` BEFORE INSERT ON `custody_movement` WHEN NEW.`release_witnessed_by_user_id` IS NOT NULL AND NEW.`release_witnessed_by_user_id` = NEW.`release_identity_verified_by_user_id` BEGIN
  SELECT RAISE(ABORT, 'a witnessed custody release needs two different people');
END;
--> statement-breakpoint
-- Release capture belongs only to a release. Hung on a move or a check-out it would read as evidence
-- of a check nobody made, on a row nothing gates.
CREATE TRIGGER `custody_movement_release_capture_scope` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` <> 'released' AND (NEW.`release_authority_basis` IS NOT NULL OR NEW.`release_identity_evidence` IS NOT NULL OR NEW.`release_identity_verified_by_user_id` IS NOT NULL OR NEW.`release_witnessed_by_user_id` IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'release capture belongs only to a released movement');
END;
