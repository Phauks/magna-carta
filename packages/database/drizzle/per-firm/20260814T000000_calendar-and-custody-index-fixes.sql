-- Index set corrections for three reads the load-profile harness measured, and the retirement of two
-- indexes that turned out to have no reader.
--
-- Hand-written rather than generated because it drops indexes as well as adding them, and because one
-- of the drops removes a partial index drizzle-kit cannot express and therefore cannot see. The column
-- comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.

-- "What is on this member's calendar" resolves as an EXISTS over matter_event_participant supplying
-- BOTH the event and the member. Only the member column was indexed, so each candidate event paid a
-- walk proportional to how many events that member is on. With both columns the lookup is a covering
-- seek.
CREATE INDEX `matter_event_participant_member_event_index` ON `matter_event_participant` (`member_user_id`,`event_id`);--> statement-breakpoint
-- Strictly subsumed by the composite above: `member_user_id` is its leading column, so every read the
-- single-column index could serve, the composite serves.
DROP INDEX `matter_event_participant_member_index`;--> statement-breakpoint

-- The register list is ordered by (created_at, id) descending on every page, keyset pages included.
-- Without an index covering that ordering every page was a full table scan into a temporary B-tree,
-- which is the cost keyset pagination exists to remove. Both columns are immutable, so this index is
-- written once when a packet is created and never again — the status and location updates every
-- movement makes do not touch it.
CREATE INDEX `custody_packet_created_index` ON `custody_packet` (`created_at`,`id`);--> statement-breakpoint

-- The firm-wide calendar window reads custody movements by date with no packet to key on, and the
-- only index available was keyed on packet_id, so the window walked the whole ledger. That ledger is
-- the one table here that grows without bound — a firm holds originals for decades and appends to
-- their history the whole time — so the walk gets slower for as long as the firm keeps the property.
-- The table is append-only, which makes this index insert-only: one entry per movement a person
-- physically records.
CREATE INDEX `custody_movement_occurred_index` ON `custody_movement` (`occurred_at`,`id`);--> statement-breakpoint

-- Two indexes with no reader left.
--
-- Nothing queries custody_movement by item_id. The register's reads go by id, by packet_id, or now by
-- occurred_at; the only predicate that ever mentioned item_id was `item_id IS NULL` inside the
-- due-back reads, and it was never selective there — it matches every movement about a packet rather
-- than about one item inside it. What the index did instead was offer the planner a cheap-looking way
-- into the table that made those reads walk the whole ledger.
DROP INDEX `custody_movement_item_index`;--> statement-breakpoint
-- The partial index was built for the overdue check-out sweep. That sweep and the timeline's due-back
-- source both now drive from the packets that are out and reach the movement through the subquery
-- that picks it, so neither seeks by due_back_on and nothing else ever did.
DROP INDEX `custody_movement_due_back_index`;
