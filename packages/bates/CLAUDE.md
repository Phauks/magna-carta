# @magna-carta/bates — CLAUDE.md

**Purpose.** A matter's Bates numbers: the one register every stamp takes its numbers from, so two
documents stamped on one matter under one prefix never share a number. A `bates_range` row is one
run of numbers one stamp took, logged with the file it stamped, the saved copy, who took it and
when. This package validates in memory and composes statements into `@magna-carta/data-access`'s
effect batch; it holds no binding, reads no clock, and never touches a byte of a document. The
stamping itself is `@magna-carta/pdf`'s `stampBates`, run in the browser.

**White paper:** _Document Automation_ and _Core domain — Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).

## Key files

- `src/range-statements.ts` — the guarded take, the once-only record of the saved copy, and the
  reads the service plans with
- `src/range-service.ts` — `takeBatesRange` and `recordStampedFile`
- `src/queries.ts` — the prefix summary (each prefix and its next number) and the range list
- `src/label.ts` — `batesLabel` and `batesRangeLabel`, pure
- `src/contract.ts` — the wire shapes the routes in `apps/api-worker` publish

## Invariants that apply here

- **The overlap guard on the insert is what keeps numbers unique, not the read before it.** Two
  stamps that read the same next number both plan the same range; the one that commits second
  inserts nothing and its batch is refused. A hand-typed start inside a stamped range is refused the
  same way. This is why the register is the ranges themselves and not a counter from
  `@magna-carta/sequence-numbering`: a counter knows where a run ends, not which numbers inside it a
  hand-typed start would reach.
- **A range is never deleted and its numbers never change.** Triggers in the `bates-numbers`
  per-firm migration refuse both. A stamp that was never saved leaves its range on the register
  with no saved copy: a gap with a record, never a number handed out twice.
- **The saved copy is recorded once.** Guarded on `stamped_file_id IS NULL`, and a trigger refuses
  changing it after.
- **No prefix or file name reaches an audit row.** Identifiers, counts and the purpose only.

## Gotchas

- **The next number is one past the highest stamped**, not the first gap. A gap left by a
  hand-typed start further on stays a gap unless someone types a start inside it.
- **Retry a lost race outside the idempotent effect.** A refused batch leaves no idempotency record,
  so the route re-plans and commits again when no start number was given; with a hand-typed start it
  answers the clash instead.
