---
branch: claude/telemetry-runtime-batch
worktree: .claude/worktrees/agent-acef6e23e93186674
area: Five runtime telemetry defects — event value allowlist, the unguarded counter path, the scrub denylist's missed PII shapes, and the hardcoded handle pattern
status: review
touches: packages/telemetry/src, packages/telemetry/test, packages/telemetry/package.json, packages/telemetry/CLAUDE.md, packages/identifiers/src/nanoid.ts, packages/identifiers/src/validate.ts, packages/identifiers/test/seam-boundary.test.ts, apps/worker/src/scheduled.ts, docs/conventions/error-logging.md, changelog.d/
---

# claude/telemetry-runtime-batch

**Scope:** runtime defects in the emission path only. No schema, no API surface, no OpenAPI snapshot
change, no UI.

Five fixes, all inside `@magna-carta/telemetry` plus one call site in the worker's cron sweeps:

1. **Event values are allowlisted, not only event keys.** `defineEvent`'s build loop forces every
   value back to a flat primitive, so an object reaching a declared field through an `any`-typed call
   site is replaced instead of serialised into the log line.
2. **The counter path gained an allowlist.** A new metric catalog (`src/metrics.ts`) declares every
   metric with its ordered dimension keys; the Workers logger lays blobs out from that declaration,
   scrubs dimension values, drops undeclared metrics and dimensions, and raises tripwire counters.
3. **The scrub denylist covers separated card and phone shapes**, which is how a person actually
   types a number into the field whose error message becomes `messageHead`.
4. **The scrubber's handle exemption is derived** from the identifier generator seam rather than
   restating its length and alphabet.

**Note for concurrent streams.** Two things here change what CI enforces for everyone:

- `logger.count(...)` now requires the metric to be declared in
  `packages/telemetry/src/metrics.ts`, with its dimension keys. A new counter needs a catalog entry
  in the same change, and a metric name built by interpolation is rejected outright — pass the
  varying part as a dimension. A fitness scan over every `apps/*/src` and `packages/*/src` fails on
  both. The worker's per-firm backfill counter moved from `backfill.<name>` to
  `backfill.rows_affected` with a `backfill` dimension for exactly that reason.
- `packages/identifiers/src/nanoid.ts` exports `TOKEN_BODY_PATTERN_SOURCE`, and `validate.ts` now
  builds its per-entity patterns from it instead of a hardcoded `[A-Za-z0-9_-]{21}`. Behaviour is
  identical today (the alphabet is exactly that set at exactly that length); a stream changing the
  token alphabet or length now only has to change the seam.

A stream adding a telemetry EVENT does not collide — `src/events.ts` is untouched.
