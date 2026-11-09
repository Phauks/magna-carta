# Slice 4·2 — Custodian — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build the physical-original custody register — a location tree rooted at a firm Location,
packets and the items inside them, mandatory Directory ownership, firm-scoped custody numbers, an
append-only movement ledger with borrower and due-back tracking, holds that block destruction, and
scanned copies bound into the existing File Manager.

**Architecture:** A new pure domain package `@magna-carta/custodian` on the established
structure-versus-access seam (mirrors `@magna-carta/conflicts` and `@magna-carta/matters`): pure
TypeScript, no D1 binding, no Hono, no `env`, composing statements into `composeEffectBatch` and
returning typed results rather than throwing. Nine per-firm tables (`custody_location`,
`custody_packet`, `custody_item`, `custody_item_type`, `custody_owner`, `custody_movement`,
`custody_hold`, `custody_scan`, `custody_destruction_request`) plus the two numbering tables
(`custody_number_counter`, `custody_number_allocation`). The movement ledger is append-only, enforced
by hand-written raw-SQL triggers (the `20260709T120000_conflicts.sql` idiom — drizzle-kit cannot model
triggers). Scan bytes never touch a Custodian route: they ride the File Manager's existing presigned
upload and quarantine chokepoint, and `custody_scan` links the resulting `file` handle. Design spec:
[`docs/specs/2026-08-04-custodian-design.md`](2026-08-04-custodian-design.md).

**Tech stack:** TypeScript (ESM, ES2022), Drizzle (schema types only; migrations are hand-written raw
SQL), Cloudflare D1 (per-firm) + R2, Hono + `@hono/zod-openapi`, Vitest (+
`@cloudflare/vitest-pool-workers` for the worker suite), `vp` for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): identifier prefixes spelled out —
  `custodyPacket_`, `custodyItem_`, `custodyLocation_`, `custodyMovement_`, `custodyHold_`,
  `custodyOwner_`, `custodyScan_`, `custodyItemType_`, `custodyDestructionRequest_`; "the firm-scoped
  data-access layer", never an abbreviation; `newIdentifier`, never `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no
  ADR numbers, no "spec", no "slice 4·2" except a forward-looking "built in slice 4·2·N" schedule
  note. Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands the
  package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **A movement is appended, never updated and never deleted.** No code path anywhere issues an
  `UPDATE` or `DELETE` naming `custody_movement`; a correction is a new row.
- **A packet cannot exist without at least one owner link.** Enforced in the write path and asserted
  by a test on every creation path.
- **No money as a float.** A declared value is `amount_minor` plus a currency through
  `@magna-carta/money`.
- **Every mutation composes an `audit_log` row** in the same atomic batch, with `metadata` carrying
  identifiers only — never an item description, an owner name, a borrower, or a custody number.
- **Every mutating route is idempotency-keyed** through the chokepoint; the movement route is
  `required`.
- **One ingest chokepoint.** Scan bytes reach `clean` through the File Manager's
  `initiateUpload` / `completeUploadSession` and the existing ingest consumer. Never write a
  `file_version` row directly, and never edit `packages/file-manager/src/ingest-core.ts`.
- **No retention defaults, ever.** `retention_until` has no computed value and no default; no code
  path derives one.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals and ADR numbers reconcile at merge** if a sibling slice lands first.

## Commands

- Package tests: `pnpm --filter @magna-carta/custodian test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs`
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 4·2·1 — The register

The walking slice: a firm builds a location tree, logs a packet owned by a Directory entity with no
matter, itemizes it, links a scan, checks it out to a named borrower with a due-back date, checks it
back in, and reads a movement history that tells the whole story. Recording only — nothing is gated
except the refusals the design makes hard.

## Task 1 — Identifiers, permissions, and the package scaffold

- [ ] `packages/identifiers/src/registry.ts` + `types.ts`: nine prefixes and branded types —
      `custodyLocation`, `custodyPacket`, `custodyItem`, `custodyItemType`, `custodyOwner`,
      `custodyMovement`, `custodyHold`, `custodyScan`, `custodyDestructionRequest`.
- [ ] `packages/access-control/src/registry.ts`: `custody:read` and `custody:manage`, each with the
      one-line comment the registry's convention requires.
- [ ] `apps/worker/test/conformance.test.ts`: add `custody: "firm"` to
      `RESOURCE_BY_PERMISSION_NAMESPACE`, with the comment stating why the firm is the tenancy root —
      a packet may have no matter by construction.
- [ ] Scaffold `packages/custodian/` — `package.json` (workspace dependencies:
      `@magna-carta/money`, `@magna-carta/identifiers`, `@magna-carta/data-access`,
      `@magna-carta/database`), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, copied
      from `@magna-carta/conflicts`.
- [ ] `test/purity.test.ts` — the package imports no Hono, no `env`, no D1 binding, and no Svelte,
      mirroring the sibling packages' purity fitness test.

**Verify:** `pnpm check:scoped`, `pnpm --filter @magna-carta/custodian test`.

## Task 2 — Schema and the append-only migration

- [ ] `packages/database/src/per-firm-schema.ts`: Drizzle definitions for the nine tables plus
      `custody_number_counter` and `custody_number_allocation`, appended at the end of the file
      (additive only — sync `main` first).
- [ ] A hand-written per-firm migration adding the tables, their CHECK constraints (status enums,
      movement-kind enum, non-empty names, `approver != requester`), and the indexes the reads need:
      `(status, custody_number)` on packets, `(current_location_id)` on packets,
      `(entity_id)` on owners, `(packet_id, occurred_at, id)` on movements,
      `(due_back_on)` partial on open check-outs, `(parent_location_id)` on locations.
- [ ] The same migration adds the append-only triggers on `custody_movement` — `BEFORE UPDATE`,
      `BEFORE DELETE`, and the `BEFORE INSERT … WHEN EXISTS` replace-guard — copied in shape from
      `packages/database/drizzle/per-firm/20260908T000000_baseline.sql`.
- [ ] Register the migration in `apps/worker/src/per-firm-migrations.ts`.
- [ ] Classify `custody_packet` (depositor), `custody_owner` (owner entity), and `custody_movement`
      (borrower entity **and** borrower name — a value-keyed subject key, the frozen-address
      precedent) in the personally-identifiable-information registry. The remaining tables are
      explicitly non-personal structure and are recorded as such.
- [ ] Seed the starting `custody_item_type` catalog and the two permissions by migration.

**Verify:** migration applies against a fresh per-firm database in the fixtures harness;
`test/append-only.test.ts` proves `UPDATE`, `DELETE`, and `INSERT OR REPLACE` on `custody_movement`
all abort; `pnpm test`.

## Task 3 — The location tree

- [ ] `src/location-service.ts` — create, rename, re-parent, close. Re-parenting walks to the root
      and refuses a cycle; depth is capped in the write path.
- [ ] A root node optionally binds `firm_location_id`; a root of kind `offsite` or `bank` carries its
      own name and address and binds none.
- [ ] Closing a node while it holds packets is a named refusal (`custody-location-occupied`).
- [ ] `packages/locations/src/location-service.ts` — the close path gains a custody-root reference
      check, so closing an office with custody under it is an explicit warned action rather than a
      silent orphaning.
- [ ] `src/queries.ts` — the subtree read. Start with a recursive common table expression; the
      materialized-path-versus-closure decision is deferred to Task 10's measurement.
- [ ] Tests: a cycle is refused; the depth cap is refused; an occupied close is refused; a subtree
      read returns the transitive set in tree order.

**Verify:** package tests green.

## Task 4 — Custody numbering

- [ ] `src/numbering/counter-statements.ts` — ensure-row, guarded increment, and allocation builders,
      mirroring `packages/matters/src/numbering/counter-statements.ts` in shape and in the comment
      explaining why the allocation primary key, not the rendered-string unique index, is the
      load-bearing backstop.
- [ ] `src/numbering/render.ts` — the fixed shape (optional firm prefix, optional location code,
      zero-padded sequence) plus `deriveScopeKey`. Firm-wide scope by default; per-root scoping is a
      scoped setting. **No new scheme table and no template engine** — if the full segment-template
      engine is ever needed here, the matters renderer is extracted and shared.
- [ ] A manually assigned number touches no counter and gets no allocation row.
- [ ] Item numbers are packet-relative ordinals, not counter draws.
- [ ] `test/number-draw-concurrency.test.ts` — concurrent draws yield distinct numbers; the loser
      aborts on the allocation primary key; the bounded retry re-reads the advanced counter. Modelled
      on the matters counter test.

**Verify:** package tests green.

## Task 5 — Packets, items, owners, and the type catalog

- [ ] `src/packet-service.ts` — create (draws the number, **refuses with no owner link**), update
      descriptive fields only, add and end-date owner links, set the depositor.
- [ ] `src/item-service.ts` — add, update descriptive fields, set `intrinsic_value` (defaulted from
      the type, always overridable) and the optional declared value through `@magna-carta/money`.
- [ ] `src/item-type-service.ts` — the per-firm catalog, soft-deactivate only, following
      `matter-type-service.ts`.
- [ ] Status is **never** settable through any of these — it is derived by Task 6 only.
- [ ] `packages/custom-fields/` — widen `custom_field.target` to admit `custodyPacket`, with the
      migration and the handle-not-name binding discipline the engine already enforces.
- [ ] Tests: a packet with no owner is refused on every creation path; an owner link is ended
      temporally, never deleted; an item's `intrinsic_value` default comes from its type and survives
      an override.

**Verify:** package tests green.

## Task 6 — The movement ledger and derived status

- [ ] `src/movement-service.ts` — the **one** write path for every state change. One function, one
      `kind` discriminator, one atomic batch: the movement row, the derived packet or item status, the
      location change, and the `audit_log` row.
- [ ] `occurred_at` and `recorded_at` are distinct columns; back-dating is supported and visible.
- [ ] Every read-then-write precondition carries its predicate on the write too (D1 has no
      interactive transaction): a packet already `out` cannot be checked out again; a `released`
      packet accepts no movement except a `correction`.
- [ ] Borrower is three-way: `member` (a firm member), `entity` (a Directory person or organization),
      or `external` (a name string) — plus `due_back_on`.
- [ ] `corrects_movement_id` on a `correction` row; there is no edit path.
- [ ] `src/queries.ts` — the packet movement history (keyset-paginated, newest first) and the overdue
      check-out read.
- [ ] Tests: a table of every movement kind against its status effect; a failed status update rolls
      back the movement; a retried movement produces exactly one row.

**Verify:** package tests green; the append-only migration test still passes.

## Task 7 — Holds

- [ ] `src/hold-service.ts` — place and release. Each also appends a movement (`hold_placed` /
      `hold_released`) in the same batch.
- [ ] A hold blocks release and destruction; it does **not** block a location move.
- [ ] `packages/file-manager/` — the destruction path gains a Custodian-hold arm, so a `file` linked
      through `custody_scan` to a held packet cannot be destroyed by a retention sweep. This is the
      first real consumer of the hold blocker the deleted-file lifecycle was written against.
- [ ] Tests: each blocked action is refused by name; a location move under hold succeeds; releasing a
      hold re-enables the blocked actions.

**Verify:** package tests green; the file-manager suite green.

## Task 8 — Scanned-copy binding

- [ ] `src/scan-service.ts` — link an already-ingested `file` handle to a packet or an item, with
      `kind`, `captured_at`, `captured_by`. **No byte path in this package and no upload route in
      Custodian.**
- [ ] The filing target resolves two ways: a matter-linked packet files onto its matter in a
      subsystem-named default folder; a matterless packet files onto the per-firm **custody holding
      matter** — a `system`-flagged matter provisioned with the firm, excluded from matter lists,
      reports, conflicts, and billing. Gated on owner decision C3; if the answer is the nullable
      relaxation instead, this task changes and Task 2's schema does not.
- [ ] `packages/matters/` — the `system` flag on `matter` plus its exclusion from `listMatters`, if
      C3 lands on the holding matter.
- [ ] Tests: a scan on a matterless packet lands and is readable; a scan never satisfies any
      destruction gate; a linked file inherits the packet's holds.

**Verify:** package tests green; worker suite green.

## Task 9 — Routes

- [ ] `apps/worker/src/routes/custody/custody.ts` — the route table from the design's API section:
      locations (list, create, patch), packets (list, create, get, patch), items, owners, movements
      (post + list), holds (place + release), scans (link), item types (list + create).
- [ ] `RouteMeta` per the design's table — `resource: "firm"` on every route, `custody:read` on the
      reads, `custody:manage` on the writes, `idempotency: "required"` on the movement route.
- [ ] Problem-type registry entries: `custody-owner-required`, `custody-hold-blocks-action`,
      `custody-intrinsic-value-not-destructible`, `custody-location-cycle`,
      `custody-location-occupied`, `custody-number-exhausted`, `custody-approver-must-differ`.
- [ ] **There is no check-out route, no check-in route, and no move route** — all of them are
      `POST /movements` with a `kind`. A reviewer adding one is adding a second place the append-only
      invariant has to be enforced.
- [ ] Register in `apps/worker/src/app.ts`.

**Verify:** worker suite green including the chokepoint contract per route (401 / 403 /
404-not-403 for a deactivated member) and idempotency on every mutating route; `emit-openapi` +
`generate-client` regenerated and committed; conformance fitness green.

## Task 10 — Telemetry, load profile, and documentation

- [ ] `packages/telemetry/src/events.ts` — `custody.movementRecorded`
      (`[kind, borrowerKind, hasShipment]`). `metrics.ts` — `custody.movements` `[kind, outcome]`,
      `custody.packetsOverdue` `[bucket]`, `custody.holdBlocked` `[action, holdKind]`,
      `custody.numberDraw` `[outcome]`. **No custody number, packet handle, location name, borrower,
      or description is ever a dimension or a field.**
- [ ] `packages/fixtures/src/load-profile/` — a `custodian` volume profile (locations per office,
      packets per firm, items per packet, movements per packet with a long tail, held fraction) plus
      `custodian-generate.ts` and `custodian-measurements.ts` covering the six measured operations
      from the design's load-profile section; regenerate the committed baseline.
- [ ] **Settle the subtree read shape against the measurement** — recursive common table expression,
      materialized path, or closure table. All three are additive to the same row; only the index set
      differs. Record the answer in the package notes.
- [ ] `packages/custodian/CLAUDE.md` from the area template, restating the two structural invariants
      (append-only movements; mandatory owner) and the no-retention-defaults rule.
- [ ] A user guide under `docs/user/`; `status.d/4-2-custodian.md`; a `changelog.d/` fragment.

**Verify:** `pnpm check`, `pnpm test`, `pnpm lint:process-refs` all green; the plan scan shows index
walks, not scans, on all six measured operations.

---

# Build slice 4·2·2 — Review, destruction, labels, and reports

## Task 11 — Review dates and the reminder emission seam

- [ ] `review_on` and `review_interval_months` on packets and items; a completed review rolls the date
      forward by the interval and appends a movement.
- [ ] The reminder **emission point** is defined and wired to the Notifications registry when it
      lands; until then it is a query plus a report, never a bespoke scheduler. Overdue check-outs use
      the same emission point.

## Task 12 — The destruction workflow

- [ ] `custody_destruction_request` — request, approve (approver must differ from requester), execute,
      each appending a movement.
- [ ] Refused outright under any hold. Refused outright on an `intrinsic_value` item, **with no
      override in the API** — clearing the flag is a separate, audited, deliberate act on a specific
      object.
- [ ] `retention_until` is a nullable field a firm sets. No default, no derived value, no sweep.
- [ ] Tests: every refusal path; a self-approved request is refused; an executed destruction leaves
      the ledger and the item row intact with status `destroyed`.

## Task 13 — Labels and reports

- [ ] Printable barcode/QR labels for packets and locations, over the identifiers designed to be
      label-carrying in 4·2·1.
- [ ] Register reports: holdings per owner, holdings per location with occupancy counts, overdue
      check-outs, items due for review, packets under hold.

---

# Build slice 4·2·3 — Gated release, receipts, and portal visibility

## Task 14 — Gated release

- [ ] Release of an item requires identity and authority to be captured first; the gate is a
      precondition on the write path that already records the borrower, not a new path.
- [ ] Two-signatory release as an optional firm setting.
- [ ] The authority vocabulary is **jurisdiction-supplied, not invented here** — gated on the owner
      decisions in the design's retention and destruction section.

## Task 15 — Receipts and portal

- [ ] Deposit and release receipts generated through document automation, against templates the firm
      authors. No new document engine.
- [ ] "Items we hold for you" through the portal grant model, at a granularity settled before the
      grant model hardens (design open question 4).

---

# Build slice 4·2·4 — Stocktake and the jurisdiction engine

## Task 16 — Scan-to-locate and stocktake

- [ ] Scan a location, reconcile expected against actual contents, emit a discrepancy report. Every
      discrepancy resolution is a movement, never an edit.

## Task 17 — The will-on-death engine

- [ ] Gated on owner decision C8. A jurisdiction-keyed catalog following the trust-rules pattern —
      per-jurisdiction deadline, trigger, release-versus-lodge rule, authority basis, penalties —
      **verified against primary text at build time**, shipped one jurisdiction at a time, with an
      explicit "not encoded for your jurisdiction" state and never a silent generic fallback.

## Task 18 — The succession manifest

- [ ] An exportable, reconcilable inventory with a successor-custodian field and dual sign-off, so
      custody survives a firm merger or closure.

---

## Sequencing and gates

Slice 4·2·1 depends only on what is already on `main` — Locations, Directory, Matters, the File
Manager, custom fields, and shipping are all shipped. Slice 4·2·2's reminders depend on the
Notifications registry for delivery but not for the emission point. Slice 4·2·3 depends on document
automation for receipts and on the portal grant model for visibility, neither of which is built.
Slice 4·2·4 is gated on owner decision C8 and on a verified jurisdiction catalog.

Owner decisions C1, C2, and C3 (section 14 of the design) block the start of slice 4·2·1: the
packet/item split is baked into Task 2's schema, the mandatory owner link into Task 5, and the scan
filing target into Tasks 2 and 8. C4, C5, C9, and C10 are needed during 4·2·1 but can be answered
while it is built. C6, C7, C8, and C11 do not block 4·2·1. Design open question 1 (the subtree read
shape) is answered by Task 10's measurement, not by a decision ahead of it.
