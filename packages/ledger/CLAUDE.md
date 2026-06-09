# @magna-carta/ledger — CLAUDE.md

**Purpose.** The append-only double-entry ledger domain module — the first domain package. It
validates in memory and composes statements into @magna-carta/data-access's `composeEffectBatch`;
it never runs logic mid-transaction (D1 has no interactive transactions) and never calls external
services.

**White paper:** _Operating accounting / general ledger_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0008, ADR-0072.)
**Spec:**
[`docs/specs/2026-06-09-ledger-core-and-fixtures-design.md`](../../docs/specs/2026-06-09-ledger-core-and-fixtures-design.md).

## Key files / entry points

- `src/types.ts` — domain types (entries, lines, accounts, `Direction`)
- `src/normal-balance.ts` — the only home of the normal-balance derivation
- `src/validate.ts` — in-memory entry validation before composition
- `src/statements.ts` — statement builders for the effect batch
- `src/post-entry.ts` / `src/create-account.ts` / `src/reverse-entry.ts` — the domain operations
- `src/fitness.ts` — re-proves the invariants against stored data

## Invariants that apply here

- **Append-only.** No UPDATE/DELETE ever targets `ledger_entry` or `ledger_line`. Corrections are
  new reversing entries via `reverseEntry` (`reverses_entry_id`, UNIQUE). The sanctioned UPDATEs are
  `account_balance` (in-batch delta) and, later, `ledger_account.active` (soft close).
- **Balanced entries.** At least 2 lines, one currency, debits = credits — enforced in `validate.ts`
  before composition and re-provable by `fitness.ts`.
- **Positive amounts + direction as data.** Never re-introduce signed amounts; the schema CHECK and
  the `Direction` type are the sign-flip defense.
- **Balances in normal-balance terms.** `normal-balance.ts` is the only home of the derivation.
- **Money discipline (ADR-0061).** `Money` in, `toMinor` integers at the statement boundary; no
  floats, no rounding here (the ledger stores what it is given).
- **Clock injection.** No wall-clock reads — `ClockPort` only (`recorded_at`, future-dating check).

## Dependencies & contracts

- Depends on (ADR-0070, ADR-0071): `@magna-carta/data-access` (effect batches),
  `@magna-carta/database` (schema), `@magna-carta/identifiers`, `@magna-carta/money`.
- Pure and synchronous: produces statements for the caller to run via the data-access layer; it
  holds no D1 binding and performs no I/O of its own.

## Gotchas

- D1 has no interactive transactions — everything an operation needs to know must be read before
  composing the batch or asserted inside it; never plan logic "between" statements.
