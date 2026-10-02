---
number: 366
slug: widening-the-custom-field-target-is-a-reader-change-not-a-migration
status: Proposed
date: 2026-08-16
area: Core domain
summary: "`custom_field.target` gains `matterAsset`, and the change ships with no migration — the column is a bare `text NOT NULL` with no CHECK, drizzle's `enum` option is a TypeScript type that emits no SQL, and the lineage-head snapshot records no enum for the column, so `drizzle-kit generate` emits nothing and `check-snapshots` reports the head already current. The 4·3·3 plan asked for 'one additive migration, coordinated with the Custodian custodyPacket widening so both values land in one'; the schema says there is nothing to migrate and therefore nothing for the two widenings to share, so they are decoupled and `custodyPacket` is left to the Custodian stream to add when it needs it. What the absence of a CHECK actually means is that the database will never refuse an unrecognised target, so the whole of the safety is in the readers: the vocabulary moves to one home (`CUSTOM_FIELD_TARGETS` in @magna-carta/custom-fields), the drizzle column, the define-field request schema, and every scoped read derive from or are pinned to it, and a fitness test asserts the column's `enumValues` equals the constant. The merge catalogue's `target = 'matter'` filter is deliberately left alone and is now covered by a test written over the whole target vocabulary, so a fourth axis arrives excluded from documents by default and has to be argued in."
---

**A target the writer accepts and a reader does not recognise is a field a firm can create and never
use — and nothing at the database will stop one being created.**

**Context.** Slice 4·3's third layer of asset typing is the firm's own fields, which the matter-assets
design specifies as `custom_field.target` widening to include `matterAsset`, scoped per class through
the engine's existing `attachment_id` column. The 4·3·3 implementation plan turned that into "one
additive value, plus the migration, … coordinate with the Custodian `custodyPacket` widening if it
has not landed: one migration, both values."

That instruction does not survive contact with the schema. `custom_field` was created in the per-firm
baseline (`packages/database/drizzle/per-firm/20260908T000000_baseline.sql`) with `target` as a plain
`text NOT NULL` and no CHECK constraint, and no later migration has touched it. The `enum` option on
the drizzle column is a **TypeScript** narrowing — it emits no DDL and, as the lineage-head snapshot
shows, is not even recorded in `meta/`, so changing it produces no diff for `drizzle-kit generate` to
act on. The evidence is mechanical rather than argued: after the widening,
`pnpm --filter @magna-carta/database run check-snapshots` reports "per-firm: snapshot already matches
the schema — nothing to do".

Shipping an empty migration to satisfy the plan would have added a file to an immutable lineage that
every firm has to apply and that does nothing, and would have implied a constraint that does not
exist. The plan is wrong here and is deviated from deliberately rather than implemented.

**Decision.**

**One value, no migration.** `matterAsset` joins the vocabulary in TypeScript, in the request schema,
and in the readers. Nothing is written to `packages/database/drizzle/`.

**The two widenings are decoupled.** With no migration there is nothing for the Custodian
`custodyPacket` widening to share, so the coordination the plan asked for buys nothing and costs a
dependency between two streams. `custodyPacket` is not added here — adding a target no reader
recognises is precisely the failure this decision is about, and the safekeeping register's own
composition is the Custodian stream's to write. The engine's request schema refuses `custodyPacket`
today, which is the honest state and is asserted by a worker test so it cannot drift into silently
accepting one.

**The vocabulary gets one home, because the database is not defending it.** With no CHECK, an
unrecognised target is stored happily and goes wrong only at the reads, as a field that exists,
offers itself, and resolves nowhere — a failure with no error, no log line, and nothing to trace it
back to. So `CUSTOM_FIELD_TARGETS` in `packages/custom-fields/src/types.ts` becomes the single home;
the define-field request schema derives its `z.enum` from it, the scoped read takes its parameter
type from it, and `packages/custom-fields/test/schema-name-sync.test.ts` pins the drizzle column's
`enumValues` to it so the one restatement the dependency direction forces cannot drift.

**Every reader was walked, and the one that stays narrow says why.** The engine's value path is
target-agnostic by construction — `setCustomFieldValue` validates against the FIELD's definition and
`target_row_id` has never referenced a table on any axis — so the value-integrity rules hold on the
new axis without a line changing. The merge catalogue's `target = 'matter'` filter is **kept**: a
`custom.<handle>` key is a scalar resolved against the one row an assembly has, the matter's, and an
asset field's answers live on one of a matter's many asset rows, so admitting one would mint a key
that binds cleanly at registration and resolves to an absence on every document forever. That filter
is now covered by a test written over `CUSTOM_FIELD_TARGETS` rather than over today's non-matter
axes, so a fourth target arrives excluded from documents and has to be argued in rather than leaking
in.

**The composition lives at the route, not in the register.** `@magna-carta/matter-assets` depends on
no other domain package; the asset detail's `customFields` array is assembled in
`apps/worker/src/routes/matter-assets.ts` from `readCustomFieldValuesForScope`, one read whatever the
field count, with the asset's class as the attachment.

**Consequences.** A firm can define, scope, value, rename, archive, and read its own fields on an
asset today, under the engine's existing caps and lifecycle with no second mechanism. Asset fields
are not merge fields and are not scheduled to become them by this change. The absence of a CHECK on
`target` remains — adding one now would mean rebuilding a table under three million-row-capable
lineages to enforce a rule the readers already enforce, and the fitness test buys the same guarantee
at review time instead of at runtime.
