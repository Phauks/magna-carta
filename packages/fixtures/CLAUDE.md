# @magna-carta/fixtures — CLAUDE.md

**Purpose.** The deterministic synthetic-data harness (ADR-0034, ADR-0072). Factories call REAL
domain write paths — `createAccount` / `postEntry` / `reverseEntry` — never raw inserts; data is
valid by construction and scenarios double as integration tests.

**White paper:** _Synthetic data & fixtures (test & demo seeding)_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:**
[`docs/specs/2026-06-09-ledger-core-and-fixtures-design.md`](../../docs/specs/2026-06-09-ledger-core-and-fixtures-design.md).

## Key files / entry points

- `src/context.ts` — one seed → faker + fixed clock + seeded identifiers
- `src/local-database.ts` — in-memory per-firm database at current schema
- `src/guard.ts` — production seeding guard
- `src/demo-chart-of-accounts.ts` — the demo chart of accounts
- `src/factories.ts` — entity factories over the real write paths
- `src/scenarios.ts` — composed multi-step scenarios
- `src/demo-firm.ts` — the full demo-firm seed
- `src/load-profile/` — the volume harness (ADR-0083): profiles, generation, snapshot cache,
  measurement runner, the v1 ledger measurement set, and the `measure` script

## Invariants that apply here

- **One seed carries all determinism.** Seeded faker + the fixed clock + `seededRandomSource` —
  nothing else may produce randomness or read wall-clock time. Same seed → byte-identical rows
  (outbox `id` excepted — minted unseeded inside data-access; documented seam).
- **Real write paths only.** A raw business-table INSERT in this package is a bug. (Direct SQL is
  allowed only to corrupt state on purpose in tests, or via `setAccountBoundsStatement` — the
  Phase-3 seam primitive.)
- **Never in production.** Every seeding entry point goes through `guard.ts`; this package is never
  imported by production worker code (boundary rule, ADR-0070).
- **Demo data is demo data.** The demo chart of accounts is explicitly NOT the Phase-3 product
  chart-of-accounts template.
- **Load-profile identity is versioned.** Changing generation logic for the same profile + seed
  requires a `GENERATOR_VERSION` bump (profile parameter changes bump the profile's own
  `version`) — snapshot cache keys and committed baselines depend on it.
- **The runner's `performance.now()` is the sanctioned wall-clock read.** Timing is observation,
  never data; nothing it returns may feed generated rows.
- **Measurement contexts derive `${seed}:measure`.** Replaying the generation seed against a
  snapshot replays its identifier stream → UNIQUE collisions on the first measured write.
- **Baselines are relative, and the file says which machine.** Compare across commits on one machine;
  never across machines, and never as production latencies. `baselineEnvironment()` stamps the node
  version, platform, architecture, processor, core count, and memory into every baseline, so a reader
  diffing two of them can tell a regression from a different machine.
- **A measurement change measures; it does not also fix.** A number that moved because the corpus grew
  and a number that moved because a query was rewritten are indistinguishable once both land in one
  commit. What a profile finds is recorded where the plans are taken and fixed in its own change,
  against the baseline the measuring change already committed.

## Extending the load profile (per-slice accretion)

Every domain slice extends the harness while the slice is open (the accretion rule, ADR-0078 /
ADR-0083); `STATUS.md`'s **Load profile** column audits it per slice. The v1 mechanics:

1. **Generation.** Add the slice's volume to the generator — a sibling per-domain module beside
   `src/load-profile/generate.ts` on its pattern (or extend it directly while it stays small).
   Real write paths only; all randomness from the one `FixtureContext`. Record probe identifiers
   (the rows measurements will target, e.g. the busiest entity) in the returned probes — they land
   in the snapshot manifest for the measurement layer.
2. **Profile.** New counts/distributions are profile fields, never generator constants. Extending
   the profile's parameters bumps the profile's own `version`; changing generation logic for
   unchanged parameters bumps `GENERATOR_VERSION`. Either invalidates cached snapshots by design.
   Volume must stay plausible — size entity counts like a real established firm, not a stress test.
3. **Measured set.** Add a per-domain measurement module on the `ledger-measurements.ts` pattern:
   `Measurement` objects (use the untimed `prepare` hook for non-repeatable operations), EXPLAIN
   probes in a `hotPathPlans`-style function, and scans allowlisted only for table-wide-by-nature
   operations (with a comment naming why). Measure **volume-shaped** operations — cost that depends
   on data shape; constant-time operations belong in plain unit benchmarks, not here.
4. **Smoke + baseline.** Wire new operations into the smoke test's expected-name list, then run
   `pnpm --filter @magna-carta/fixtures run measure` and commit the regenerated baseline (a profile
   version bump renames the baseline file).

## Dependencies & contracts

- Depends on: `@magna-carta/ledger` (the write paths), `@magna-carta/data-access`
  (`commitEffectBatch`), `@magna-carta/database` (node-sqlite local adapter + migrations),
  `@magna-carta/identifiers` (seeded source), `@magna-carta/money`.
- Node-only modules (`local-database`) never ship to Workers.

## Gotchas

- node:sqlite is experimental on Node — warning noise is expected.
- The fixed clock advances only when scenarios explicitly move it.
- **The snapshotter reaps its own working copy; keep it that way.** Each `loadProfileSnapshot` call
  `mkdtemp`s a directory and copies the whole snapshot database into it, so a load that does not clean
  up strands tens of megabytes — ~125 of them once filled a disk. `close()` removes it (in a `finally`,
  so a failed handle-close still reaps), and a `process.once("exit")` reaper covers the `measure` CLI,
  whose straight-line script never reaches its own `close()` when a measurement throws. A new exit path
  out of the snapshotter needs to reap too. Only a `SIGKILL` can now leak one, and the age-bounded
  sweep in `tooling/clean/` is the backstop for that.
