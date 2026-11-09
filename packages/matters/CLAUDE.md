# @magna-carta/matters — CLAUDE.md

**Purpose.** The matter-shell domain module: the owner-shaped lifecycle (intake → consultation →
open ⇄ hold → closed), the segment-template numbering engine, per-firm matter/document types, and the
list/consultations queries. Validates in memory and composes statements into @magna-carta/data-access's
`composeEffectBatch`; never runs logic mid-transaction and never calls external services.

**White paper:** _Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0079, ADR-0080.)
**Spec:**
[`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](../../docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md).

## Key files / entry points

- `src/numbering/counter-statements.ts` — the matter tables (`matter_number_counter` /
  `matter_number_allocation`, owner column `matter_id`) bound to the shared draw. The segment model,
  the renderer, the scheme table's write path, the three built-in defaults and the per-purpose
  facts all live in `@magna-carta/sequence-numbering` now (`segments`, `render`, `scheme-service`,
  `purposes`, `scheme-draw`) — the register every numbered record in the platform draws from
- `src/numbering/sequences.ts` — what is MATTERS' OWN about each of its three sequences: the
  rendered-string collision only this package's partial unique indexes can see. `matterSequenceOf`
  is the only reader; everything else about a sequence is `purposeOf(purpose)` on the register
- `src/matter-service.ts` — `createMatter`/`openMatter`/`closeMatter`/`reopenMatter`/`renumberMatter`/`updateMatter`
- `src/close-preconditions.ts` — the close-precondition hook: a `check` plus an optional in-batch `commitGuard`
- `src/close-advisories.ts` — the close-ADVISORY hook: a `notice` and nothing else. Deliberately a
  separate mechanism, not a precondition with a softer flag — one boolean away from each other, a
  subsystem that only meant to inform starts blocking closes
- `src/matter-type-service.ts` — types CRUD (soft-deactivate)
- `src/matter-assignment.ts` — staffing beyond the responsible attorney: list + compose-create/end.
  The responsible attorney's one home stays `matter.responsible_member_id`; an assignment role that
  normalizes to it (the letters-and-digits rule party roles use) is refused. Ending an assignment
  stamps `valid_to` and keeps the row — who carried a file is the matter's record.
- `src/matter-court-case.ts` / `src/matter-estate.ts` — the matter's court-and-case and estate
  identity records: one live record per matter (partial unique index), upserted as facts accrete,
  every person/organisation a Directory reference validated live before the write. The estate's
  styles are STORED court-fixed designations, never composed.
- `src/matter-file-retention.ts` — the date the firm's own PAPER file may be destroyed after, one
  row per matter in `matter_file_retention`. A date a person states, never derived, and read by
  nothing that deletes: it is a reminder on the status window and the firm calendar. Every write
  audits the date it replaced, because the row holds only the current one.
- `src/member-professional-profile.ts` — the whole-record profile upsert keyed by the member's own
  user id; the one home for that write (route and fixtures share it). A bar number is deliberately
  NOT a column here — it is a protected Directory identifier.
- `src/queries.ts` — `listMatters` (excludes intakes and consultations by default) + `listConsultations` (with the stale flag)

## Invariants that apply here

- **Three sequences, one per rung, drawn at different moments and all frozen at assignment.** An
  intake draws an INTAKE number the moment it is created (`numbering_scheme.purpose = 'intake'`); it
  draws a CONSULTATION number when it graduates (`graduateMatter`, gated by the intake procedure the
  composition root registers) — or the moment it is created, when a consultation is recorded
  outright; `openMatter` then draws the MATTER number. **Each draw ADDS a number beside the last and
  never rewrites one**, so a file quoted under any number it has ever worn still resolves, and a
  matter that came the whole way carries all three. Once assigned, a matter number never changes
  except by deliberate `renumberMatter`. The runs never share a counter — a rung that goes no further
  must consume nothing from a run it never reached, because a gap in the matter run reads as a lost
  file and a consultation run pitted with declined enquiries cannot be told apart from one with
  records missing.
- **What a sequence IS lives on the numbering register, not in conditionals.** The scope prefix,
  the label a non-convergence is reported under, the built-in default and the parts a scheme may
  use are facts about a sequence, held one row per purpose in
  `@magna-carta/sequence-numbering/purposes`; the one fact that cannot leave this package — the
  retryable rendered-string collision on the matter table — is `src/numbering/sequences.ts`. Only
  the matter purpose has `fallbackScheme: null` — there is no defensible shape to invent for a
  firm's own file spine — so consultation and intake render from their built-in defaults until the
  firm configures its own, and neither is ever left unnumbered while somebody gets round to the
  settings screen. The draw itself (`runMatterDraw`) is the shared planner's four steps plus this
  package's own batch: `planSchemeDraw`, `observe`, the opening statements, the matter write, the
  allocation.
- **Counter idiom (atomic, race-proof).** Read `next_value` → render → compose [ensure-row INSERT,
  **guarded** `UPDATE … WHERE scope_key = ? AND next_value = ?`, matter write, **allocation INSERT**].
  A zero-row guarded UPDATE is not an error, so the guard alone aborts nothing: the backstop is the
  **`matter_number_allocation` primary key `{scope_key, drawn_value}`** — the loser's batch aborts on the
  drawn VALUE and the bounded-retry idiom re-reads the advanced counter. The **UNIQUE index on
  `matter_number`** stays for what it alone covers: a rendered number colliding with a manually assigned
  court/legacy number. It cannot catch the general race — a scheme may render a variable segment that is
  not marked scoping, so two draws in one scope produce different strings from the same value.
- **Scope key = scoping segment values in template order, `:`-joined** (rendered values are URL-safe, so
  `:` cannot collide); empty string = firm-wide. A consultation draw prefixes its scope key with
  `CONSULTATION_SCOPE_PREFIX` (`consultation/`) and an intake draw with `INTAKE_SCOPE_PREFIX`
  (`intake/`), so all three sequences count separately in the SAME counter and allocation tables —
  `/` is outside the URL-safe set, so no matter scope key can forge one, and the two prefixes are
  distinct words so neither can forge the other. Manual numbers touch no counter and get no
  allocation row.
- **Lifecycle transitions are guarded in the batch, not only pre-read.** D1 has no interactive
  transaction, so every read-then-write precondition needs its predicate on the UPDATE too: `openMatter`
  writes `AND status = 'consultation'` and confirms after the commit that the row carries the number it
  drew; `graduateMatter` writes `AND status = 'intake'` and confirms the consultation number the same way; `holdMatter` writes `AND status IN ('open', 'consultation')` and `releaseMatter` writes `AND status = 'hold'`, each confirming the committed status afterwards so a hold never overwrites a close that landed in between; `closeMatter` writes `AND status != 'closed'` so a racing close never moves `closed_at`. A
  precondition is skipped when the Idempotency-Key has already been seen — that is the same request
  retried, and the shared primitive replays its stored response.
- **A hold draws nothing and surrenders nothing.** `hold` is reached from `open` or from
  `consultation` (an active matter the firm has stopped working, or a consultation it has parked
  without deciding on; an intake has nothing yet to pause), keeps whichever number the matter
  wears, and carries its reason and its instant on the row (`hold_reason`, `held_at`, paired by
  `matter_hold_check`). `releaseMatter` clears both and returns the matter to where the hold found
  it, reading `opened_at` as the one honest signal: stamped, it goes back to `open`; empty, it was
  a consultation and goes back to `consultation`. A close leaves the hold's facts standing, so
  `reopenMatter` reads `held_at` first and returns a matter closed while on hold to that hold. The
  docket includes held matters that were numbered; the conflicts corpus treats them as live;
  auto-file rules still fire on them. There is no precondition registry on either side of a hold:
  nothing gates it but the `matters:hold` permission, which is one authority in both directions.
- **A consultation closes as a matter does, and draws no number by closing.** A firm that decides
  against a consultation closes it; `closeMatter` runs the same preconditions (a consultation with
  nothing on its ledgers passes them), and the consultation keeps its tentative number and never
  consumes a matter number. `reopenMatter` restores `consultation` when that is what it left.
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
