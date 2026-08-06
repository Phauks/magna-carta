# @magna-carta/sequence-numbering — CLAUDE.md

**Purpose.** The one home of the sequential-number draw: a counter row per scope, a guarded
increment, an allocation row per value consumed, and the bounded retry a losing draw takes. Extracted
out of `@magna-carta/matters` so matters and billing run on ONE mechanism instead of drifting copies.
Pure and dependency-light: statement builders parameterized by table names and the owning-row column,
plus the conflict predicate and the retry helper. No I/O, no clock, no database binding.

**Spec:** [`docs/specs/2026-08-05-billing-design.md`](../../docs/specs/2026-08-05-billing-design.md)
(_Numbering_). (ADR-0079.)

## Key files / entry points

- `src/counter-statements.ts` — `SequenceNumberingTables` + `ensureCounterRowStatement` /
  `guardedIncrementStatement` / `allocateCounterValueStatement` / `isNumberAllocationConflict` /
  `readCounterValue`
- `src/bounded-retry.ts` — `drawWithBoundedRetry`: the loop that advances a lost draw's counter OUT
  OF BAND and re-reads

## Invariants that apply here

- **The guarded increment is NOT the guard.** A zero-row UPDATE is not an error in SQLite, so a
  drawer that loses the race commits happily having changed nothing and two drawers walk away
  believing they hold the same value. The load-bearing mechanism is the ALLOCATION primary key
  `{scope_key, drawn_value}`: the loser's whole batch aborts on the value itself. Never "simplify"
  this by dropping the allocation row.
- **A consumer's own uniqueness index on the RENDERED number cannot substitute.** A scheme carrying a
  variable segment that is not marked scoping renders different strings from the same counter value
  in one scope. That index stays for what it alone covers (a rendered number colliding with a
  manually assigned court or legacy number) and is registered through `alsoRetryable`.
- **The allocation is composed AFTER the owning row's write.** The owner column is a foreign key, so
  the row this draw numbers has to exist by the time the allocation statement runs.
- **A lost draw advances the counter out of band, guarded on the observed value.** The in-batch
  increment rolled back with everything else, so the retry would otherwise re-read the same value
  forever; guarding the out-of-band advance means a concurrent winner that already moved the counter
  makes it a no-op, and two losers never double-advance it.

## Dependencies & contracts

- Depends only on `@magna-carta/data-access` for the `SqlDatabase` / `SqlStatement` shapes.
- Consumed by `@magna-carta/matters` (matter numbers) and `@magna-carta/billing` (invoice numbers).
  A change here RIPPLES to both — re-run both suites, never just one.

## Gotchas

- **`isNumberAllocationConflict` matches two shapes.** A consumer whose allocation table also carries
  an append-only no-overwrite BEFORE INSERT guard sees that trigger fire ahead of the primary key on
  a duplicate key, so the loser reads as an append-only refusal rather than a UNIQUE constraint. Same
  event, same retry. Matters' table has no such trigger; billing's does.
- **`@magna-carta/custodian` carries its own copy** of this idiom for custody numbers, predating the
  extraction. It is not consumed from here yet; folding it in is a mechanical move with custodian's
  existing suite as its proof.
