# @magna-carta/community — CLAUDE.md

**Purpose.** The community board's domain layer: its category taxonomy, its closed sets, the
format-only confidentiality detector, the distinct-firm ranking, the public projections, the wire
contract, and the statement builders that read and write the board's control-plane tables. It holds
no HTTP and no framework; `apps/community-worker` is the only thing that serves it.

**White paper:** _Community & feedback forum_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). **Spec:**
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../docs/specs/2026-08-11-community-surfaces-design.md).
**Tenancy:** the board's cross-firm exception is a decision of its own; the
[Decision Log](../../docs/Decision-Log.md) is its home.

## Key files / entry points

- `src/categories.ts` — the seventeen product areas. **Read the comment at the top before touching
  it**; the absence of a general category is load-bearing for two other things in this package.
- `src/types.ts` — the closed sets (kinds, statuses, decline reasons, visibilities, flag reasons,
  moderation actions) and the two thresholds (`SPAM_REPORT_DISTINCT_FIRM_THRESHOLD`,
  `ARCHIVE_AFTER_DAYS`).
- `src/confidentiality-detector.ts` — format-only signals over a post's text. Pure, no clock, no
  storage, and it never consults a firm's records.
- `src/ranking.ts` — the distinct-firm ordering and `DISTINCT_FIRM_DISPLAY_FLOOR`. The trending
  arithmetic here is duplicated in SQL in `src/data-access/post-statements.ts`; the parity test in
  `test/ranking.test.ts` is what stops them drifting.
- `src/projection.ts` — the identity chokepoint. Every reader-facing shape is built here.
- `src/contract.ts` — the zod request and response schemas. Response schemas are `.strict()`.
- `src/sql.ts` — this package's own minimal SQL interface, and the comment explaining why it is not
  imported from the firm-scoped data-access layer.
- `src/data-access/` — the statement builders, one module per table family, plus `tables.ts`.

## Local conventions

- **The firm identifier is written and never rendered.** It is on every authored row for ranking,
  rate limiting and moderation, and no public type has a field for it. A new read path returns its
  rows through `src/projection.ts`, never assembled inline.
- **A counter is recomputed, never incremented.** `recountPostVotesStatement` and
  `recountPostCommentsStatement` read the vote and comment rows. An increment drifts silently the
  first time a batch half-applies.
- **A multi-row write is one batch.** A vote is a row plus two counters; a hide is a visibility flip
  plus a moderation record. Half of either is worse than neither.
- **A guarded UPDATE reports its own outcome.** Zero rows changed is not an error in SQLite, so a
  caller that needs to know whether its write won reads `meta.changes` — the author-delete guard,
  the question-cannot-have-a-status guard, and the restore guard all work this way.

## Invariants that apply here

- **This package imports no per-firm module.** Not the firm-scoped data-access layer, not the
  per-firm schema, not a per-firm domain package, and no statement of its own names a per-firm
  table. `test/purity.test.ts` fails the build on any of those. The board is the platform's one
  deliberately cross-firm surface, so this is what stands in for the per-firm database boundary.
- **The detector reads shape and nothing else.** Checking a post against the author's own Directory
  or matter list would be a per-firm read from a cross-firm surface — the exact thing the isolation
  above exists to prevent — and the worker holds no binding that could perform it. Format-only
  means more false positives, which the remove-first posture makes affordable.
- **There is no general category, and no revision history.** Both absences are asserted by tests
  rather than remembered. The identity model depends on the first; a member's ability to make an
  over-identifying post unreadable depends on the second.
- **The voter list is never returned.** Aggregate counts only, and the distinct-firm count only at
  or above `DISTINCT_FIRM_DISPLAY_FLOOR`.

## Dependencies & contracts

- Depends on `@magna-carta/identifiers` (branded handles) and `zod`. `@magna-carta/database` and
  `drizzle-orm` are dev-only, used by the tests to run against the real committed migration.
- Consumed by `apps/community-worker` and by nothing else. The tables it names live in
  `packages/database/src/control-plane-schema.ts`.

## Gotchas

- **The trending score is hyperbolic, not exponential, on purpose.** `pow` and `exp` are SQLite's
  optional math functions and `julianday` and division are not; a score that silently fails to
  evaluate reorders the board rather than raising anything.
- **`status` is null for a question**, and that is the absence of a pipeline rather than a nullable
  field waiting to be filled. `setPostStatusStatement` is guarded on `kind = 'request'`.
- **The post-number allocation row is the concurrency guard, not the counter update.** A losing
  drawer's guarded UPDATE matches zero rows and commits happily; the allocation primary key is what
  aborts its batch. The retry loop lives in the worker's board service.
- **`vp test` runs the whole repo.** For this package alone use
  `pnpm --filter @magna-carta/community run test`, and never run two test invocations at once.
