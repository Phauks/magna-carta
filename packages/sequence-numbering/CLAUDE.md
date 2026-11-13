# @magna-carta/sequence-numbering — CLAUDE.md

**Purpose.** The one home of every number the firm issues: the register of purposes (what each
sequence is, when it is drawn, which parts it may be built from, what decides its counter's scope,
what renders until the firm writes its own), the segment-template scheme model and its renderer, the
scheme table's write path, the draw planner every purpose composes its batch from, and underneath
all of it the
sequential-number draw itself — a counter row per scope, a guarded increment, an allocation row per
value consumed, and the bounded retry a losing draw takes. Grown out of `@magna-carta/matters`, which
owned the scheme engine while matters were the only sequence a firm could shape, so that matters,
conflicts, custodian and billing run on ONE mechanism and one settings screen instead of drifting
copies. Pure and dependency-light: statement builders parameterized by table names and the
owning-row column, plus the register, the renderer and the retry helper. No I/O beyond the reads the
planner is handed a database for, no clock, no binding.

**Spec:** [`docs/specs/2026-08-05-billing-design.md`](../../docs/specs/2026-08-05-billing-design.md)
(_Numbering_). (ADR-0079; the register is
`docs/decisions/0480-every-number-the-firm-issues-is-drawn-from-one-register.md`.)

## Key files / entry points

- `src/purposes.ts` — **the register**: `NUMBERING_PURPOSES`, one row per purpose (`matter`,
  `consultation`, `intake`, `conflicts_check`, `custody_packet`, `invoice`, `time_entry`,
  `communication` — every one of them shaped by a scheme since the owner's ruling of 2026-09-19),
  the built-in default schemes with the reasoning for each, `scopeSource` and
  `scopeDistinguishedBy`, the scope prefixes, `purposeOf` / `schemePurposeOf` /
  `SCHEME_NUMBERING_PURPOSES`
- `src/segments.ts` — `NumberSegment` types, `NUMBER_SEGMENT_KINDS`, `URL_SAFE_PATTERN`, the zod
  `numberingSchemeSchema` (exactly one counter), `startValueOf`
- `src/render.ts` — `renderNumber` + `deriveScopeKey` (pure; dates and codes arrive as strings in a
  `RenderContext`), `NumberingRenderError`
- `src/scheme-statements.ts` / `src/scheme-service.ts` — the `numbering_scheme` table's
  one-active-scheme-PER-PURPOSE write path; `readSchemeInForce` (configured, else the register's
  default, else undefined); `schemeSchemaFor(purpose)` (the shape rules plus the purpose's own
  vocabulary)
- `src/scheme-draw.ts` — `planSchemeDraw`: load the scheme in force, settle the scope (the
  template's scoping parts under the purpose's prefix, or the key the caller passed for an
  owner-scoped run), read the counter, render `count` consecutive numbers;
  `schemeDrawOpeningStatements`; `previewNextNumber`; `NumberingSchemeMissingError`
- `src/counter-statements.ts` — `SequenceNumberingTables` + `ensureCounterRowStatement` /
  `guardedIncrementStatement` / `allocateCounterValueStatement` / `isNumberAllocationConflict` /
  `readCounterValue`
- `src/bounded-retry.ts` — `drawWithBoundedRetry`: the loop that advances a lost draw's counter OUT
  OF BAND and re-reads, plus `BoundedDrawOptions` / `DrawNonConvergence` (the caller's retryable
  collisions and the error it gives up with)

## Invariants that apply here

- **A new sequence is one row on the register, not a new engine.** Its label, its default, its
  scope prefix and the parts it may use go in `purposes.ts`; its `purpose` value goes on the scheme
  table's enum (`packages/database/src/per-firm-schema.ts` — no CHECK, so no rebuild); its counter
  and allocation tables go in the owning package with the owner column named. The owning package
  then composes `planSchemeDraw` + `schemeDrawOpeningStatements` + its own write + the allocation,
  under `drawWithBoundedRetry`. Nothing about the new number's SHAPE goes in the owning package: a
  render function there is a second engine, and the second engine is what this package replaced
  twice (custodian's fixed-shape record, conflicts' `MAX + 1`).
- **Only the matter purpose refuses to default.** A matter number is the firm's own file spine and
  there is no defensible shape to invent for one; every other purpose renders its built-in default
  until the firm writes its own, because refusing to open a conflicts check or log a deed packet
  until somebody has visited the settings screen is the worse failure. `fallbackScheme: null` is
  the whole of that rule.
- **A scheme is validated against its purpose's vocabulary at the save, not at the draw.** A
  conflicts check has no client code to render; `schemeSchemaFor` refuses the part where the person
  who wrote the scheme is looking, so the first draw cannot be the place it is discovered. It
  refuses three things on that principle: a part the purpose cannot render, a scoping mark on an
  owner-scoped run, and an owner-scoped scheme missing its `scopeDistinguishedBy` part.
- **A counter's scope comes from the template OR from the domain, and the register says which.**
  `scopeSource: "segments"` is the general case and the collision-proof one: the scope key IS the
  joined rendered values of the scheme's scoping parts, so two records in different scopes differ
  in a part the number renders. `scopeSource: "owner"` is for a run the domain scopes — a time
  entry counts within its matter's handle, an invoice within the letterhead the bill was finalized
  under — and there the caller passes the key, because neither is a value the template renders. A
  scoping mark on such a run is refused rather than stored as a switch that does nothing, and
  `scopeDistinguishedBy` names the part that keeps two scopes' rendered numbers apart, because an
  owner-scoped template gets no uniqueness for free — two matters both count 0001. The invoice run
  names none, because a firm has one letterhead scope until it deliberately opens a second; that
  refusal lives at finalize (`packages/billing/src/finalize.ts`), where the bill drawn under a
  scope the scheme does not render is refused by name.
- **A default renders what the run has always rendered.** Every purpose that joined the register
  after its sequence was already issuing numbers carries a default that is byte-for-byte its old
  renderer — the call number's year, month, day and count; the entry number's matter number, dot
  and count. That is the whole licence for retiring a hand-written renderer, so a change to one of
  those defaults is a change to numbers a firm has already said out loud, not a refactor.
- **Padding is a floor, never a ceiling.** `renderNumber` pads the counter to `padWidth` and never
  truncates: a run past its width grows a digit rather than wrapping or refusing, so no sequence
  ever "runs out". A default that restarts the count each year (the `year` segment marked scoping)
  is how a busy run keeps the width a person expects.
- **The guarded increment is NOT the guard.** A zero-row UPDATE is not an error in SQLite, so a
  drawer that loses the race commits happily having changed nothing and two drawers walk away
  believing they hold the same value. The load-bearing mechanism is the ALLOCATION primary key
  `{scope_key, drawn_value}`: the loser's whole batch aborts on the value itself. Never "simplify"
  this by dropping the allocation row.
- **A consumer's own uniqueness index on the RENDERED number cannot substitute.** A scheme carrying a
  variable segment that is not marked scoping renders different strings from the same counter value
  in one scope. That index stays for what it alone covers (a rendered number colliding with a
  manually assigned court or legacy number, or one drawn before the sequence joined the register)
  and is registered through `alsoRetryable`.
- **The allocation is composed AFTER the owning row's write.** The owner column is a foreign key, so
  the row this draw numbers has to exist by the time the allocation statement runs.
- **A lost draw advances the counter out of band, guarded on the observed value.** The in-batch
  increment rolled back with everything else, so the retry would otherwise re-read the same value
  forever; guarding the out-of-band advance means a concurrent winner that already moved the counter
  makes it a no-op, and two losers never double-advance it.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` for the `SqlDatabase` / `SqlStatement` shapes and the domain
  audit wrapper, `@magna-carta/identifiers` for the scheme id, and `zod` for the scheme schema.
- Consumed by `@magna-carta/matters` (matter, consultation and intake numbers),
  `@magna-carta/conflicts` (check numbers), `@magna-carta/custodian` (custody packet numbers),
  `@magna-carta/billing` (invoice numbers), `@magna-carta/timekeeping` (time entry numbers, drawn a
  block at a time), `@magna-carta/communications` (call and text numbers), and the API worker's
  `apps/api-worker/src/http/routes/firm/numbering.ts` (the settings surface over the register). Every one of them draws through
  `planSchemeDraw` and none of them renders a number itself. A change here RIPPLES to all of them —
  re-run every one of their suites, never just one. Custodian's is the sharpest test of a change: a custody number is
  printed on a physical label and read out over the phone, so a rendered-shape change there is not a
  refactor.

## Gotchas

- **`isNumberAllocationConflict` matches two shapes.** A consumer whose allocation table also carries
  an append-only no-overwrite BEFORE INSERT guard sees that trigger fire ahead of the primary key on
  a duplicate key, so the loser reads as an append-only refusal rather than a UNIQUE constraint. Same
  event, same retry. Matters', conflicts' and custodian's tables have no such trigger; billing's
  does.
- **`planSchemeDraw` reads; it never writes.** A consumer whose effect builds eagerly (the domain
  effect seam in conflicts) plans BEFORE building the effect and feeds `observe` from the plan; a
  replayed idempotency key that never executes the batch has consumed nothing by planning.
- **`drawWithBoundedRetry` is the only retry loop over these statements.** Matters and custodian each
  kept a private copy until the shared loop could express what they needed, which was two things.
  **`nonConvergenceError` is required**: giving up leaves this package and becomes an HTTP response,
  so the caller supplies the error — custodian a named `CustodyValidationError` its route maps to a
  problem type, matters a plain `Error` the standard pipeline reports. A mapper rather than a result
  type, because every caller's translation is "throw mine" and a result type would put the
  "did not converge after N attempts" wording back into each consumer. It is required rather than
  defaulted so a new sequence cannot inherit a bare `Error` by saying nothing.
  **Retryable-ness and observed-ness are independent**: a declared collision that observed no draw is
  still retried, there is simply no counter to advance. Custodian reaches its draw only after
  resolving the shared custody holding matter, and a concurrent first use of that matter loses on
  `matter.system_key` before any counter has been read.
