-- Two structural gaps in the custody register, closed at the database because that is where the rest
-- of the register's guarantees already live. Hand-written rather than drizzle-kit-generated: every
-- statement here is a trigger, which drizzle-kit cannot model at all. No column is added and no table
-- is rebuilt, so this migration is purely additive and copies no existing row through anything.
--
-- (1) THE RELEASE SIGNATORIES ARE BOUND TO REAL PEOPLE. The gate added by
-- 20260805T130000_custody-gated-release.sql required a capture and required the two signatories to
-- differ. It did not require either of them to be anybody: both identifiers arrived in the request
-- body, so one member could record a release and type a colleague's handle — or a well-formed handle
-- belonging to nobody — into the witness field, and the ledger would permanently assert that two
-- people signed off on a handover only one person witnessed.
--
-- The member who checked identity is now the member who recorded the row, and the witness has to be
-- an ACTIVE member of this firm. Both facts are checked at the write path too; they are re-asserted
-- here for the same reason the destruction rules are — a rule enforced in one caller is a rule with
-- the other callers standing open beside it.
--
-- These are BEFORE INSERT triggers, exactly as the existing three are, and for the same reason: a
-- CHECK would mean rebuilding custody_movement and copying every existing row through it, and every
-- release recorded before this migration was recorded honestly under the rules that then applied.
-- Making history pass a rule nobody applied at the time is the one thing an append-only ledger must
-- never do, so the binding is future-only and the record of what actually happened is left alone.
CREATE TRIGGER `custody_movement_release_verifier_is_recorder` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` = 'released' AND (NEW.`recorded_by_user_id` IS NULL OR NEW.`release_identity_verified_by_user_id` <> NEW.`recorded_by_user_id`) BEGIN
  SELECT RAISE(ABORT, 'the member who checked identity on a release is the member recording it, and cannot be named on their behalf');
END;
--> statement-breakpoint
-- A witness the firm does not employ is not a second person; it is a string. Deactivated counts as
-- not employed: somebody who has left could not have stood at the safe. The same shape as the
-- disbursement rules, which read the member roster from a trigger rather than trusting a route.
CREATE TRIGGER `custody_movement_release_witness_is_active_member` BEFORE INSERT ON `custody_movement` WHEN NEW.`release_witnessed_by_user_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `member` WHERE `user_id` = NEW.`release_witnessed_by_user_id` AND `status` = 'active') BEGIN
  SELECT RAISE(ABORT, 'the witness on a custody release must be an active member of this firm');
END;
--> statement-breakpoint
-- (2) A CLOSED COUNT IS FROZEN AT THE DATABASE. custody_stocktake_sighting carries four RAISE(ABORT)
-- triggers, including one that refuses an observation against a count that is no longer open. The
-- parent row those guards key off — the row that holds the frozen counts and the `open` status —
-- carried none, so the freeze was held up entirely by the fact that one guarded UPDATE is the only
-- UPDATE anybody has written. A repair path, an import, or a hand-run fix that re-opened a closed
-- count would make the sighting guard accept new observations against a reconciliation a firm has
-- already reported, and the next close would overwrite the frozen numbers.
--
-- A BEFORE UPDATE that aborts on a non-open row leaves the ordinary close alone (it updates a row
-- whose OLD.status is 'open') and refuses every re-open, every second close, and every edit to a
-- closed count's findings.
CREATE TRIGGER `custody_stocktake_frozen_once_closed` BEFORE UPDATE ON `custody_stocktake` WHEN OLD.`status` <> 'open' BEGIN
  SELECT RAISE(ABORT, 'a closed or abandoned custody stocktake is frozen');
END;
--> statement-breakpoint
-- REPLACE / INSERT OR REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the
-- BEFORE DELETE or BEFORE UPDATE triggers (SQLite runs recursive_triggers OFF by default), so it
-- would silently replace a closed count that a plain UPDATE cannot touch. A BEFORE INSERT guard that
-- aborts when the id already exists DOES fire on the insert half of a REPLACE. Normal inserts carry
-- fresh random ids, so the existence check never matches on the happy path.
CREATE TRIGGER `custody_stocktake_no_replace` BEFORE INSERT ON `custody_stocktake` WHEN EXISTS (SELECT 1 FROM `custody_stocktake` WHERE `id` = NEW.`id`) BEGIN
  SELECT RAISE(ABORT, 'a custody stocktake row is replaced by no write path; close it or abandon it');
END;
