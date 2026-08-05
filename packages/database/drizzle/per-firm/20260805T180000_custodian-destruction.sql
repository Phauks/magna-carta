-- Destruction of a client's original: the columns the workflow needs to record a refusal and an
-- execution, and the triggers that make its two hard rules structural rather than conventional.
-- Hand-written rather than drizzle-kit-generated because of the triggers, which drizzle-kit cannot
-- model at all. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD, AND WHY.
--
-- No retention column, no default period, no derived date, and no sweep. How long a firm must keep a
-- client's property is the most jurisdiction-bound fact in this subsystem, and a default here would be
-- a platform opinion about when to destroy somebody's irreplaceable property. What is added is the
-- record of a decision two named people made, and the refusals that decision can never talk its way
-- past.
ALTER TABLE `custody_destruction_request` ADD COLUMN `refused_by` text;--> statement-breakpoint
ALTER TABLE `custody_destruction_request` ADD COLUMN `refused_at` text;--> statement-breakpoint
-- Why a request was refused, in the refuser's words. Free text for the same reason the basis is: the
-- reasons are jurisdictional, professional, and factual by turns, and a closed list would be this
-- schema deciding which of them a firm is allowed to have.
ALTER TABLE `custody_destruction_request` ADD COLUMN `refusal_reason` text;--> statement-breakpoint
ALTER TABLE `custody_destruction_request` ADD COLUMN `executed_by` text;--> statement-breakpoint
-- The ledger row the execution appended. Declared WITHOUT a foreign key, exactly as
-- custody_movement.corrects_movement_id is: the movement ledger carries no referential dependency, and
-- keeping it that way is what lets the table be rebuilt when its kind vocabulary widens.
ALTER TABLE `custody_destruction_request` ADD COLUMN `executed_movement_id` text;--> statement-breakpoint
-- The pending queue: everything awaiting a second person, oldest first.
CREATE INDEX `custody_destruction_request_outcome_index` ON `custody_destruction_request` (`outcome`,`requested_at`);--> statement-breakpoint
-- TWO PEOPLE, ENFORCED AT THE DATABASE.
--
-- The table already carries a CHECK that an approver differs from a requester, but a CHECK cannot see
-- what a NULL means: a row whose requester is null satisfies it whatever the approver is. A trigger
-- can, so these two refuse an approval that names no requester at all as well as one naming the same
-- person twice. Both halves exist because a request may arrive already approved (an INSERT) or be
-- approved afterwards (an UPDATE), and a rule enforced on one path is a rule with a door in it.
--
-- Triggers rather than a rebuilt CHECK for the reason the release gate gives: adding a CHECK means
-- copying every existing row through it, and a BEFORE trigger binds every row written from here on
-- while leaving the record of what actually happened alone.
CREATE TRIGGER `custody_destruction_request_two_person_insert` BEFORE INSERT ON `custody_destruction_request` WHEN NEW.`approved_by` IS NOT NULL AND (NEW.`requested_by` IS NULL OR NEW.`approved_by` = NEW.`requested_by`) BEGIN
  SELECT RAISE(ABORT, 'a custody destruction is approved by a different person from the one who requested it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_two_person_update` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`approved_by` IS NOT NULL AND (NEW.`requested_by` IS NULL OR NEW.`approved_by` = NEW.`requested_by`) BEGIN
  SELECT RAISE(ABORT, 'a custody destruction is approved by a different person from the one who requested it');
END;
--> statement-breakpoint
-- AN ITEM OF INTRINSIC VALUE IS NOT DESTRUCTIBLE, AND THERE IS NO ROUTE PAST THIS.
--
-- This is the one hard policy in the subsystem, and it is encoded because it is not jurisdictional: no
-- jurisdiction's rules produce "destroy the client's original will because a timer expired". Every
-- source consulted converges on originals of intrinsic value being returned to the client or kept,
-- never routinely destroyed. The flag is a person's assertion about a specific object, so clearing it
-- is a deliberate, audited, human act on that object — which is the only override, and it is not an
-- override of this rule but a change to the fact the rule reads.
--
-- A packet-scoped request (item_id NULL) is refused when ANY item in the packet carries the flag:
-- destroying the envelope destroys the will inside it.
CREATE TRIGGER `custody_destruction_request_intrinsic_value` BEFORE INSERT ON `custody_destruction_request` WHEN EXISTS (SELECT 1 FROM `custody_item` WHERE `intrinsic_value` = 1 AND (`id` = NEW.`item_id` OR (NEW.`item_id` IS NULL AND `packet_id` = NEW.`packet_id`))) BEGIN
  SELECT RAISE(ABORT, 'an item of intrinsic value is never destructible');
END;
--> statement-breakpoint
-- The flag can be set after a request is raised — someone looks in the envelope and finds the will.
-- The execution has to read the fact as it stands at execution, not as it stood when the request was
-- typed, so the same question is asked again on the way out.
CREATE TRIGGER `custody_destruction_request_intrinsic_value_on_execution` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`executed_at` IS NOT NULL AND OLD.`executed_at` IS NULL AND EXISTS (SELECT 1 FROM `custody_item` WHERE `intrinsic_value` = 1 AND (`id` = NEW.`item_id` OR (NEW.`item_id` IS NULL AND `packet_id` = NEW.`packet_id`))) BEGIN
  SELECT RAISE(ABORT, 'an item of intrinsic value is never destructible');
END;
--> statement-breakpoint
-- The same rule aimed at the ledger itself. The destruction workflow is not the only way to append a
-- `destroyed` movement, and a rule that only the workflow enforced would be a rule with the ordinary
-- movement write path standing open beside it. This trigger closes that, so "an item of intrinsic
-- value cannot be destroyed" is a property of the database rather than of the code paths that
-- currently exist.
CREATE TRIGGER `custody_movement_intrinsic_value_not_destructible` BEFORE INSERT ON `custody_movement` WHEN NEW.`kind` = 'destroyed' AND EXISTS (SELECT 1 FROM `custody_item` WHERE `intrinsic_value` = 1 AND (`id` = NEW.`item_id` OR (NEW.`item_id` IS NULL AND `packet_id` = NEW.`packet_id`))) BEGIN
  SELECT RAISE(ABORT, 'an item of intrinsic value is never destructible');
END;
--> statement-breakpoint
-- A hold forbids the property ceasing to exist, at both ends of the workflow: raising the request and
-- carrying it out. Asking only once would let a hold placed in the window between them be stepped over
-- by an approval that predates it.
CREATE TRIGGER `custody_destruction_request_hold_blocks_request` BEFORE INSERT ON `custody_destruction_request` WHEN EXISTS (SELECT 1 FROM `custody_hold` WHERE `packet_id` = NEW.`packet_id` AND `released_at` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a hold is in force on this packet and forbids destroying it');
END;
--> statement-breakpoint
CREATE TRIGGER `custody_destruction_request_hold_blocks_execution` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`executed_at` IS NOT NULL AND OLD.`executed_at` IS NULL AND EXISTS (SELECT 1 FROM `custody_hold` WHERE `packet_id` = NEW.`packet_id` AND `released_at` IS NULL) BEGIN
  SELECT RAISE(ABORT, 'a hold is in force on this packet and forbids destroying it');
END;
--> statement-breakpoint
-- Nothing is destroyed that two people did not agree to destroy. Execution reads the row as it was
-- committed, so an approval that never landed cannot be supplied by the same statement that carries
-- the execution out.
CREATE TRIGGER `custody_destruction_request_execution_requires_approval` BEFORE UPDATE ON `custody_destruction_request` WHEN NEW.`executed_at` IS NOT NULL AND OLD.`executed_at` IS NULL AND (OLD.`approved_by` IS NULL OR OLD.`approved_at` IS NULL OR OLD.`outcome` IS NULL OR OLD.`outcome` <> 'approved') BEGIN
  SELECT RAISE(ABORT, 'a custody destruction is carried out only after a second person has approved it');
END;
--> statement-breakpoint
-- A finished request is finished. Refused, executed, and withdrawn are terminal: re-deciding one would
-- rewrite a decision somebody has already acted on, which is the same falsification the append-only
-- ledger forbids one row at a time. A fresh request is the way to ask again.
CREATE TRIGGER `custody_destruction_request_decided_once` BEFORE UPDATE ON `custody_destruction_request` WHEN OLD.`outcome` IN ('refused', 'executed', 'withdrawn') BEGIN
  SELECT RAISE(ABORT, 'this destruction request has already been decided; raise a new one');
END;
