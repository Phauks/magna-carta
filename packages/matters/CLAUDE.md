# @magna-carta/matters — CLAUDE.md

**Purpose.** The matter-shell domain module: the owner-shaped lifecycle (prospective consultation →
open → closed), the segment-template numbering engine, per-firm matter/document types, and the
list/consultations queries. Validates in memory and composes statements into @magna-carta/data-access's
`composeEffectBatch`; never runs logic mid-transaction and never calls external services.

**White paper:** _Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0079, ADR-0080.)
**Spec:**
[`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](../../docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md).

## Key files / entry points

- `src/numbering/segments.ts` — `NumberSegment` types + the zod scheme schema (exactly one counter)
- `src/numbering/render.ts` — `renderMatterNumber` + `deriveScopeKey` (pure; dates/codes arrive as strings)
- `src/numbering/counter-statements.ts` — ensure-row + guarded-increment + allocation builders
- `src/numbering/scheme-service.ts` / `scheme-statements.ts` — the one-active-scheme write path
- `src/matter-service.ts` — `createMatter`/`openMatter`/`closeMatter`/`reopenMatter`/`renumberMatter`/`updateMatter`
- `src/close-preconditions.ts` — the close-precondition hook: a `check` plus an optional in-batch `commitGuard`
- `src/close-advisories.ts` — the close-ADVISORY hook: a `notice` and nothing else. Deliberately a
  separate mechanism, not a precondition with a softer flag — one boolean away from each other, a
  subsystem that only meant to inform starts blocking closes
- `src/matter-type-service.ts` — types CRUD (soft-deactivate)
- `src/queries.ts` — `listMatters` (excludes prospective by default) + `listConsultations` (with the stale flag)

## Invariants that apply here

- **The number is drawn at open, frozen at assignment.** A prospective consultation carries no number;
  `openMatter` draws it. Once assigned, a matter number never changes except by deliberate `renumberMatter`.
- **Counter idiom (atomic, race-proof).** Read `next_value` → render → compose [ensure-row INSERT,
  **guarded** `UPDATE … WHERE scope_key = ? AND next_value = ?`, matter write, **allocation INSERT**].
  A zero-row guarded UPDATE is not an error, so the guard alone aborts nothing: the backstop is the
  **`matter_number_allocation` primary key `{scope_key, drawn_value}`** — the loser's batch aborts on the
  drawn VALUE and the bounded-retry idiom re-reads the advanced counter. The **UNIQUE index on
  `matter_number`** stays for what it alone covers: a rendered number colliding with a manually assigned
  court/legacy number. It cannot catch the general race — a scheme may render a variable segment that is
  not marked scoping, so two draws in one scope produce different strings from the same value.
- **Scope key = scoping segment values in template order, `:`-joined** (rendered values are URL-safe, so
  `:` cannot collide); empty string = firm-wide. Manual numbers touch no counter and get no allocation row.
- **Lifecycle transitions are guarded in the batch, not only pre-read.** D1 has no interactive
  transaction, so every read-then-write precondition needs its predicate on the UPDATE too: `openMatter`
  writes `AND status = 'prospective'` and confirms after the commit that the row carries the number it
  drew; `closeMatter` writes `AND status != 'closed'` so a racing close never moves `closed_at`. A
  precondition is skipped when the Idempotency-Key has already been seen — that is the same request
  retried, and the shared primitive replays its stored response.
- **Closed = archived-but-additive.** A closed matter still accepts documents; close runs the
  preconditions first. This package's own registry is EMPTY and stays empty — a rule belongs to the
  subsystem that owns the thing it guards, and the composition root passes them in through
  `closePreconditions`, so the matter shell never imports the financial core to find out whether a
  matter holds money. A precondition may also contribute a `commitGuard`: statements that ride the
  close batch and abort it if the condition its `check` read has changed by commit time (the read and
  the write cannot be atomic here). A guard must be a statement that either matches nothing or
  violates a constraint — a guarded `UPDATE` matching zero rows would leave the audit row, the event,
  and the idempotency record behind, recording a close that did not happen. A close may also carry
  ADVISORIES: notices that ride the successful response and have no arm on which they refuse. They
  take no `commitGuard` because there is nothing to re-assert — an advisory that went stale by commit
  time was still true of the matter the person was looking at.
- **Every mutation audited.** The spec §10 outbox event + an `audit_log` row ride in the same batch.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`. Does NOT
  import `@magna-carta/locations`: the renderer takes a plain `RenderContext` of strings; the route
  handler assembles it (location code, type code, client code, staff initials, client name).
- Pure and synchronous: produces statements for the caller to run; holds no D1 binding, does no I/O.

## Gotchas

- A scoping segment whose context value is absent at render time is a named-code refusal
  (`scheme-segment-value-missing`) — e.g. a location-scoped scheme on a matter with no Location and no
  firm default. Resolve the value before opening, don't render a blank.
- D1 has no interactive transactions — read before composing, or assert inside the batch.
