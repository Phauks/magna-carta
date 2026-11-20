# @magna-carta/bates — CLAUDE.md

**Purpose.** A matter's Bates numbers. A matter keeps as many Bates logs as it needs, one per
filing or production that wants numbers of its own; each log has a name, a prefix and a padding,
and counts from its own start. A `bates_range` row is one run of numbers one stamp took from a log,
recorded with the file it stamped, the saved copy, who took it and when. This package validates in
memory and composes statements into `@magna-carta/data-access`'s effect batch; it holds no binding,
reads no clock, and never touches a byte of a document. The stamping itself is
`@magna-carta/pdf`'s `stampBates`, run in the browser.

**White paper:** _Document Automation_ and _Core domain — Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).

## Key files

- `src/log-statements.ts`, `src/log-service.ts` — starting and renaming a log, and `requireLog`
- `src/range-statements.ts` — the guarded take, the once-only record of the saved copy, and the
  reads the service plans with
- `src/range-service.ts` — `takeBatesRange` (from a log) and `recordStampedFile`
- `src/queries.ts` — the log list (each log and its next number) and the range list
- `src/label.ts` — `batesLabel` and `batesRangeLabel`, pure
- `src/contract.ts` — the wire shapes the routes in `apps/api-worker` publish

## Invariants that apply here

- **The overlap guard on the insert is what keeps numbers unique within a log, not the read before
  it.** Two stamps that read the same next number both plan the same range; the one that commits
  second inserts nothing and its batch is refused. A hand-typed start inside a stamped range is
  refused the same way. This is why a log's count is its ranges and not a counter from
  `@magna-carta/sequence-numbering`: a counter knows where a run ends, not which numbers inside it a
  hand-typed start would reach.
- **Logs never check each other.** Two logs may share a prefix, so the same printed number can exist
  in two logs on one matter; the log's name is what tells the filings apart. Uniqueness holds inside
  a log only.
- **A log's prefix and padding never change, and a log is never deleted.** Triggers in the
  `bates-logs` per-firm migration refuse both; only the name may change. The prefix and padding are
  also copied onto each range, because they are what was printed.
- **A range is never deleted and its numbers and log never change.** Triggers refuse both. A stamp
  that was never saved leaves its range in the log with no saved copy: a gap with a record, never a
  number handed out twice.
- **The saved copy is recorded once.** Guarded on `stamped_file_id IS NULL`, and a trigger refuses
  changing it after.
- **No prefix, log name or file name reaches an audit row.** Identifiers, counts and the purpose
  only.

## Gotchas

- **The next number is one past the highest stamped**, not the first gap. A gap left by a
  hand-typed start further on stays a gap unless someone types a start inside it.
- **Retry a lost race outside the idempotent effect.** A refused batch leaves no idempotency record,
  so the route re-plans and commits again when no start number was given; with a hand-typed start it
  answers the clash instead.
- **`log_id` is nullable in the schema only because it was added to a table with rows.** The
  migration gave every earlier range a log (one per matter and prefix, named for the prefix); every
  range taken since names one.
