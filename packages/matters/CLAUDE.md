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
- `src/numbering/counter-statements.ts` — ensure-row + guarded-increment builders
- `src/numbering/scheme-service.ts` / `scheme-statements.ts` — the one-active-scheme write path
- `src/matter-service.ts` — `createMatter`/`openMatter`/`closeMatter`/`reopenMatter`/`renumberMatter`/`updateMatter`
- `src/close-preconditions.ts` — the named close-precondition hook registry (empty this slice; Phase 3 registers the zero-balance rule)
- `src/matter-type-service.ts` — types CRUD (soft-deactivate)
- `src/queries.ts` — `listMatters` (excludes prospective by default) + `listConsultations` (with the stale flag)

## Invariants that apply here

- **The number is drawn at open, frozen at assignment.** A prospective consultation carries no number;
  `openMatter` draws it. Once assigned, a matter number never changes except by deliberate `renumberMatter`.
- **Counter idiom (atomic, race-proof).** Read `next_value` → render → compose [ensure-row INSERT,
  **guarded** `UPDATE … WHERE scope_key = ? AND next_value = ?`, matter INSERT]. A concurrent draw makes
  the guard match zero rows and the loser's matter INSERT hits the **UNIQUE index on `matter_number`**,
  aborting its batch — retried by the bounded-retry idiom. The UNIQUE backstop is load-bearing.
- **Scope key = scoping segment values in template order, `:`-joined** (rendered values are URL-safe, so
  `:` cannot collide); empty string = firm-wide. Manual numbers touch no counter.
- **Closed = archived-but-additive.** A closed matter still accepts documents; close runs the precondition
  registry first (empty this slice).
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
