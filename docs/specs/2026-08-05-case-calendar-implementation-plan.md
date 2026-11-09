# Slice 6·1 — Case calendar and matter timeline — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build the backend a case calendar reads — first-class litigation events and deadlines that
exist nowhere today, and a federated read layer that joins them with the subsystem tables that
already record what the firm did, under one comparable sort key, one shared cursor, and one
visibility predicate. No user interface in this slice.

**Architecture:** A new pure domain package `@magna-carta/calendar` on the established
structure-versus-access seam (mirrors `@magna-carta/custodian` and `@magna-carta/conflicts`): pure
TypeScript, no D1 binding, no Hono, no `env`, composing statements into `composeEffectBatch` and
returning typed results rather than throwing. Four new per-firm tables (`matter_event`,
`matter_event_type`, `matter_event_participant`, `matter_deadline`), one column added to `location`
(`time_zone`), and two indexes added to shipped tables (`audit_log`, `conflicts_check`). The read
layer is a **source registry**: each timeline source declares its time column, its statement builder,
and its projection, and the merge is a k-way merge in application memory over bounded per-source
reads issued in one `batch()`. Nothing is projected, copied, or backfilled. Design spec:
[`docs/specs/2026-08-05-case-calendar-design.md`](2026-08-05-case-calendar-design.md).

**Tech stack:** TypeScript (ESM, ES2022), Temporal for the civil-date and zone handling, Drizzle
(schema types only; the index and seed migrations are hand-written raw SQL), Cloudflare D1
(per-firm), Hono + `@hono/zod-openapi`, Vitest (+ `@cloudflare/vitest-pool-workers` for the worker
suite), `vp` for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): identifier prefixes spelled out — `matterEvent_`,
  `matterEventType_`, `matterEventParticipant_`, `matterDeadline_`; "the firm-scoped data-access
  layer", never an abbreviation; `newIdentifier`, never `newId`; `timeZone`, never `tz`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no
  ADR numbers, no "spec", no "slice 6·1" except a forward-looking "built in slice 6·1·N" schedule
  note. Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands
  the package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **No naive local datetime, anywhere.** A date is `YYYY-MM-DD` text; a time is `HH:MM` text; a zone
  is an IANA identifier; an instant is UTC ISO-8601 from the injected clock. No column stores
  midnight-local-as-UTC, and the coherence fitness function must stay green.
- **Every source's statement builder takes the visibility predicate as a REQUIRED argument** and
  composes it into the `WHERE` clause before the `LIMIT`. Never a post-filter in the Worker.
- **No unbounded read.** Every source statement carries a `LIMIT`; every date-ranged read carries a
  capped window; the deadline horizon is capped.
- **Nothing computes a deadline date.** No business-day arithmetic, no holiday calendar, no service
  offsets, no cascade when a trigger moves. No code path derives a `due_on`.
- **Nothing writes "missed".** Overdue is a read-time comparison; there is no sweep and no state
  transition for it.
- **A timeline entry carries no privileged content.** Identifiers, kinds, instants, actors, deep
  links, and each source's declared non-privileged label — never a subject line, a narrative, an
  authority note, or a participant name on a firm-wide read.
- **Every mutation composes an `audit_log` row** in the same atomic batch, `metadata` carrying
  identifiers only.
- **Every mutating route is idempotency-keyed** through the chokepoint.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals and ADR numbers reconcile at merge** if a sibling slice lands first.

## Commands

- Package tests: `pnpm --filter @magna-carta/calendar test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs`
- Per-firm migrations: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`, then
  `refresh-per-firm-snapshot` in the SAME commit as any hand-written migration
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 6·1·1 — The recorded model

The walking slice: a member records a hearing on a matter with a courtroom, a time, a zone, and two
participants; records a deadline with a stated authority; satisfies it with the filing event that
discharged it; and reads the matter's events back newest-first. Recording only — no federation yet,
so the timeline in this slice covers exactly the two recorded sources.

## Task 1 — Identifiers, permissions, and the package scaffold

- [ ] `packages/identifiers/src/registry.ts` + `types.ts`: four prefixes and branded types —
      `matterEvent`, `matterEventType`, `matterEventParticipant`, `matterDeadline`.
- [ ] `packages/access-control/src/registry.ts`: `calendar:read` and `calendar:manage`.
- [ ] `packages/calendar/` scaffold on the `@magna-carta/custodian` shape: `package.json`,
      `tsconfig.json` with its own `compilerOptions` (the pure-package gotcha), `vitest.config.ts`,
      `src/index.ts`, and a `CLAUDE.md` from the area template.
- [ ] Register the package in the workspace and the TypeScript project references.

## Task 2 — Schema: the four tables and the location column

- [ ] `packages/database/src/per-firm-schema.ts`: `matter_event_type`, `matter_event`,
      `matter_event_participant`, `matter_deadline` per the design's section 4 and 5 column lists,
      with the check constraints named there — status and state sets, non-empty titles,
      `ends_on >= starts_on`, an end time only where there is a start time, the participant-kind
      shape check mirroring `custody_movement_borrower_shape_check`, the
      `catalog_entry_key`/`catalog_version` presence check tied to `source = 'statutory_catalog'`,
      and a `state_reason` required on `vacated` and `superseded`.
- [ ] Add `time_zone` to `location` — nullable, IANA identifier, expand-contract.
- [ ] Indexes: `matter_event(matter_id, starts_on, id)`, `matter_event(starts_on, id)`,
      `matter_event(status, starts_on)`, `matter_event_participant(event_id)`,
      `matter_deadline(state, due_on, id)`, `matter_deadline(matter_id, due_on, id)`.
- [ ] Generate the migration, then hand-write the `matter_event_type` platform seed rows (the
      section 4.2 vocabulary, `origin = 'platform'`) and append to the journal.
- [ ] Refresh the per-firm snapshot **in the same commit** and run `check-snapshots`.
- [ ] Test: the migration chain applies to a fresh `node:sqlite`; every check constraint rejects its
      bad case; no table rebuild is emitted.

## Task 3 — The event write path

- [ ] `src/event-statements.ts` + `src/event-service.ts`: create, update, cancel, and the participant
      replace-set. Typed results, no throws, statements composed into an effect batch.
- [ ] The zone is validated as a resolvable IANA identifier at the write, not at the read — a row
      that cannot be rendered must not be storable.
- [ ] Every mutation composes a `domainAuditStatement` row: `calendar.event.created`,
      `calendar.event.updated`, `calendar.event.cancelled`, metadata carrying identifiers only.
- [ ] Test: an event with an end before its start is refused; an end time without a start time is
      refused; an unknown zone is refused; a participant whose kind names an empty column is refused;
      an update writes exactly one audit row.

## Task 4 — The event-type catalog

- [ ] `src/event-type-service.ts`: create, rename, deactivate. A platform-origin row's `name` and
      `code` are immutable; deactivation is permitted on any row.
- [ ] Test: renaming a platform row is refused; a firm row with a colliding name is refused; a
      deactivated type resolves on existing events but is not offered for new ones.

## Task 5 — The deadline write path

- [ ] `src/deadline-statements.ts` + `src/deadline-service.ts`: create, update, satisfy, vacate,
      supersede.
- [ ] `source = 'statutory_catalog'` is **accepted but unreachable** in this slice: no catalog exists,
      so no caller can supply a `catalog_entry_key`. The column and its check land now because the
      alternative is a table rebuild later; a test asserts the create path refuses that source until
      a catalog is registered.
- [ ] `satisfy` requires an actor and an instant and optionally names the satisfying event; `vacate`
      and `supersede` require a reason.
- [ ] **No code path anywhere derives `due_on`.** A source-scan test asserts no date arithmetic in
      the package outside the read-time overdue comparison.
- [ ] Test: satisfying an already-satisfied deadline is refused; vacating without a reason is
      refused; a satisfying event on a different matter is refused.

## Task 6 — Overdue as a read-time comparison

- [ ] `src/overdue.ts`: given a deadline row and an instant, resolve `due_on` + `due_at_time` in
      `time_zone` to an instant and compare. A deadline with no time is due at the end of its day in
      its own zone.
- [ ] Test with a fixed clock across a DST boundary in both directions, and across a zone whose
      offset differs from the server's. Nothing writes a column.

## Task 7 — The first two routes

- [ ] `apps/worker/src/routes/calendar/calendar.ts`: `GET /api/v1/matters/{matterId}/events` and the write
      routes from the design's section 10.2, all declaring route metadata (`permission`, `audited`,
      `idempotency`, `resource`).
- [ ] Emit the OpenAPI snapshot and regenerate the typed client.
- [ ] Worker integration test: a member records a hearing, adds participants, records and satisfies a
      deadline, and reads both back; a caller without `calendar:manage` is refused the writes.

## Task 8 — Wire the location time zone through

- [ ] `packages/locations`: `time_zone` on the create and update paths, validated as IANA.
- [ ] `packages/document-assembly/src/resolve.ts`: `timeZoneForLocation` returns the location's
      column, falling back to the platform-normalized zone when null. **This is the only edit to that
      package**; do not touch a formatter.
- [ ] Update `packages/document-assembly/CLAUDE.md`'s named-seam entry, which currently says the
      column does not exist.
- [ ] Test: an assembly for a matter whose office carries a zone renders a date in that zone; a
      matter whose office does not is byte-identical to today.

---

# Build slice 6·1·2 — The source registry and federation

The slice that makes the timeline a timeline. Nothing new is recorded; everything already recorded
across the platform becomes readable in one order.

## Task 1 — The registry and the merge

- [ ] `src/sources/registry.ts`: the `TimelineSource` declaration shape from the design's section 7 —
      `key`, `kinds`, `timeColumnShape`, `buildStatements(scope, visibility, cursor, limit)`,
      `project(row)`, `label`.
- [ ] `src/merge.ts`: the k-way merge over per-source result sets, comparing sort keys **as text**,
      trimming to `pageSize`, and minting the next cursor from the last kept entry.
- [ ] Reuse `encodeCursor` / `decodeCursor` from `packages/data-access/src/cursor-pagination.ts`
      unchanged — the calendar mints no new wire contract.
- [ ] Test: the merge is a total order over mixed civil dates and instants; a civil date sorts at the
      head of its own day; paging through a merged corpus visits every entry exactly once with no
      duplicate and no gap, including when several sources tie on the same sort key.

## Task 2 — The visibility predicate

- [ ] `src/visibility.ts`: `VisibleMatterPredicate` — a composable SQL fragment plus bindings.
      Today's one clause is `matter.system_key IS NULL`.
- [ ] It is a **required** argument of `buildStatements`, not an optional one with a default.
- [ ] Fitness test: every registered source's built statement contains the predicate's fragment. A
      source that omits it fails the suite.
- [ ] Test: the platform-owned custody holding matter never appears in any read.

## Task 3 — The directly-matter-linked sources

Register the sources that reach their matter without a join, each a statement builder plus a
projection plus a declared label (or a declared absence of one):

- [ ] `matterEvent` (`starts_on`, civil date) and `matterDeadline` (`due_on`, civil date).
- [ ] `emailFiled` — `email_matter_link.created_at`, over the shipped
      `email_matter_link_matter_created_id_index`. **Declares no label**: a subject line is
      privileged content.
- [ ] `documentAssembly` — `document_assembly.created_at`, over the shipped composite. Label: the
      outcome and the absent-field count.
- [ ] `documentFiled` — `file.created_at`, over `file_matter_id_created_at_id_index`, excluding
      soft-deleted rows. Label: the document type where set, never the file name.
- [ ] `timeEntry` (`work_date`) and `costEntry` (date). Labels: duration and amount. Both are
      registered but the design expects a user interface to default them off (owner flag L6).
- [ ] Test per source: the statement is bounded, composes the predicate, and projects no privileged
      column. A shared table-driven test asserts all three properties for every registered source
      rather than once per source.

## Task 4 — The two index additions on shipped tables

- [ ] Hand-written migration: `audit_log(subject_id, created_at, id)` and
      `conflicts_check(subject_matter_id, created_at, id)`. Both are additive index creations against
      tables holding data — no rebuild.
- [ ] Refresh the per-firm snapshot in the same commit.
- [ ] Test: the migration applies cleanly to a populated fixture database.

## Task 5 — The `audit_log` lifecycle source

- [ ] `matterLifecycle` — `audit_log` filtered to a **strict allowlist** of event keys
      (`matter.opened`, `matter.closed`, `matter.reopened`) with `subject_id = matterId`, over the
      new composite index.
- [ ] The allowlist is a frozen constant with a comment stating why the audit log is not the general
      substrate — the occurred-versus-recorded argument, in the code, not a reference to this plan.
- [ ] Test: a settings-change audit row never appears on a timeline; the three lifecycle events do.

## Task 6 — The canonical-instant fitness test

- [ ] For every source declaring `timeColumnShape: 'instant'`, assert every value in the load-profile
      corpus matches `YYYY-MM-DDTHH:mm:ss.sssZ` exactly.
- [ ] The test's failure message must state the consequence — a variant precision reorders the
      timeline — because the failure is otherwise inscrutable.

## Task 7 — The matter timeline route

- [ ] `GET /api/v1/matters/{matterId}/timeline` with `kind` (repeatable, **filtering the registry
      before any statement is built**), `from`/`to`, `direction`, and `cursor`.
- [ ] Assert in a test that a single-`kind` request issues exactly one source statement.
- [ ] Worker integration test: a matter with rows in six sources returns one correctly ordered page;
      page two continues without gap or repeat; a `kind` filter narrows both the results and the
      statement count.

## Task 8 — Load-profile corpus and the four measurements

- [ ] Extend the fixtures generator with the section 12 litigation corpus.
- [ ] Assert: page 20 is not materially slower than page 1; statement count per page equals the
      registered source count (plus join pre-reads, zero in this slice); rows read per page is within
      `sourceCount × (pageSize + 1)`; and record the firm-wide-window baseline for slice 6·1·3.

---

# Build slice 6·1·3 — The join-reached sources, the deadline surface, and the firm calendar

## Task 1 — Ascending keyset pagination

- [ ] `packages/data-access/src/cursor-pagination.ts`: an ascending counterpart to
      `appendCursorPredicate` and `assemblePage`, sharing the existing cursor encoding so the wire
      contract does not fork. Do not change the existing DESC helpers.
- [ ] Test: an ascending page walk over a fixture set visits every row once; a cursor minted
      ascending and decoded ascending round-trips byte-identically.

## Task 2 — The custody sources

- [ ] `custodyReviewDue` — `custody_packet.review_on` and `custody_item.review_on` over the
      hand-written partial review indexes. Forward-looking, and the cheapest real win in the slice.
- [ ] `custodyDueBack` — `custody_movement.due_back_on` over its hand-written partial index.
- [ ] `custodyMovement` — `custody_movement.occurred_at`, reached through a **bounded pre-read** of
      the matter's packets, then `packet_id IN (...)`. **`occurred_at`, never `recorded_at`.**
- [ ] Label: the custody number and the movement kind. Never an item description, an owner, or a
      borrower.
- [ ] Test: a movement back-dated to a prior week sorts by when it happened, not when it was typed —
      the assertion the whole federated design rests on.

## Task 3 — The trust source

- [ ] `trustMovement` — `trust_movement.effective_date`, reached through the matter's
      `trust_ledger_node` leaf (at most one per trust account, by the shipped unique index) then the
      node's shipped effective-date index.
- [ ] Label: kind, amount, and currency through `@magna-carta/money`. Never a counterparty name.
- [ ] Test: a matter with movements in two trust accounts returns both, ordered together.

## Task 4 — The conflicts source

- [ ] `conflictsCheck` — `conflicts_check.created_at` filtered on `subject_matter_id`, over the index
      added in 6·1·2. Label: the trigger and the hit count.

## Task 5 — The deadline and firm-calendar reads

- [ ] `GET /api/v1/calendar/deadlines` — ascending by due date, horizon-capped, `state` and
      `overdue` filters, the overdue flag computed per row at read time.
- [ ] `GET /api/v1/calendar/events` — `from`/`to` required, window capped at the owner-decided figure
      (flag L5) as a **refusal**, not a silent clamp; `matterId`, `memberId`, and `kind` filters all
      composed into SQL.
- [ ] `memberId` resolves to "a participant, or the matter's responsible member" as a predicate.
- [ ] Test: an over-wide window is refused with a named problem type; a walled-out matter (simulated
      by extending the visibility predicate in the test) disappears from the firm calendar without
      changing any source.

## Task 6 — The firm-wide-window measurement and its verdict

- [ ] Run measurement 4 against the full registry and record the result in the slice's status
      fragment.
- [ ] If it misses budget, **do not build the read model in this slice.** Record the number, name the
      dominant source, and raise the read model as its own slice — the design's escape hatch is
      gated on a measurement, and a projection built in a hurry is the thing the design argued
      against.

## Task 7 — Notification emission points, declared

- [ ] A frozen constant naming the six emission points from the design's section 11, with no
      scheduler, no outbox topic, and no delivery.
- [ ] Test: the constant is exported and nothing imports it as a side effect. It exists so the
      Notifications registry has something to bind to, and so the raise sites are obvious when it is.

## Task 8 — Documentation

- [ ] `packages/calendar/CLAUDE.md`: the source-registry contract, the canonical-instant obligation,
      the visibility-predicate rule, the "no deadline arithmetic" rule, and how to add a source (one
      registry row, one statement builder, one projection, one label decision — never a write-path
      change).
- [ ] `docs/user/`: a guide for recording events and deadlines, in user language, with no
      architecture and an explicit statement that the platform does not calculate deadlines.
- [ ] `roadmap.d/calendar.md`: move `calendar.surface` and the event model off `not-started`; leave
      `calendar.docketing` where it is.
- [ ] `changelog.d/` and `status.d/` fragments; never `CHANGELOG.md`, `STATUS.md`, or `ROADMAP.md`
      directly.

---

# Named later slices

- **6·1·4 — The rebuildable timeline read model.** Only if measurement 4 says so.
- **6·1·5 — The statutory deadline catalog binding.** Gated on custodian owner decision C8; the
  propose-and-confirm interaction, the catalog key and version columns already in place.
- **6·2 — The calendar user interface.** Month, week, agenda, and matter timeline over the two reads.
- **6·3 — Notification wiring.** The scheduled sweep, through the Notifications registry.
- **Phase 7 — External synchronization and court adapters.** Each a writer into `matter_event` with
  the provenance column added alongside its writer.
