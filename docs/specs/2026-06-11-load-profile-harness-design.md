# Load-Profile Harness — design (cross-cutting slice)

**Status:** Designed 2026-06-11 · ADR-0083 · Cross-cutting (phase-independent)
**Slice stage home:** [`STATUS.md`](../../STATUS.md) (Cross-cutting section) · narrative scope in [`ROADMAP.md`](../../ROADMAP.md)
**This is the general design** (scope + architecture + boundaries); the implementation plan follows as its own document.

## 1. Purpose

Golden rule 10 says "measure before optimizing; optimize against the load-profile harness, not guesses" — and [`docs/conventions/performance.md`](../conventions/performance.md) names the fixtures load profile "the standing performance/scaling harness." The white paper (_Synthetic data & fixtures_) defines it as the third entry point of the one fixtures engine: a **volume-parameterized load profile (thousands of matters) for query/scaling tests, snapshotted to a fixtures artifact for instant, cheap replay.** Slice 0·3 built the first two entry points (named scenarios, demo-firm bundle) and explicitly deferred this one (ledger-and-fixtures design §5.5). This slice builds it.

Three jobs:

1. **Make the "optimize when measured" gates fireable.** A growing list of deferred decisions names this harness as its measurer — first among them the slice 0·3 efficiency candidates (read coalescing in `reverseEntry`/`createAccount`, prepared-statement caching, chart-seed batching), deliberately not applied pending measurement. A gate with no measurer never fires; this is the measurer. (Storage-economics gates are _not_ this harness's job — they read from the ADR-0078 per-firm storage-metering rollup. This harness measures performance and scaling: latency, query plans, growth curves.)
2. **Make the slice definition-of-done real.** "How we work" (root `CLAUDE.md`) requires each slice to be perf-tested against the load-profile fixtures as built. Until the harness exists that requirement is unfulfillable; from this slice on it binds.
3. **Supply realistic-density data for UI work.** The white paper's UI multiplier: interfaces are built and reviewed on load-profile fixtures — real density, long values, empty states, large lists — never toy data. Slice 0·7a's Storybook catalog and slice 1·1's first screens consume this.

## 2. Scope

**V1 (this slice):** the harness machinery — profiles, generation, snapshot/replay, the query-level measurement runner, baselines — plus the **ledger volume profile**, the only domain with schema today.

**The accretion rule (ADR-0078's build-when-in-the-area principle):** every subsequent domain slice extends the harness _while the slice is open_ — its volume generator joins the active profile and at least one slice-relevant operation joins the measured set. That is how the definition-of-done perf-test stays cheap: the marginal cost per slice is small; only the retrofit is expensive. Slice 1·1 adds matters/locations/files (and the R2 blob layer of the snapshot artifact); 1·3 adds the Directory graph; Phase 3 adds financial volume.

**Out of scope (named seams, not omissions):**

- **Request-path measurement** (HTTP through Miniflare/the worker): a named seam in the runner design, built after slice 0·5 lands the contract pipeline — measuring routes before the chokepoint stack exists would measure a stack about to change.
- **CI performance budgets/gates:** `performance.md` defers concrete budgets until there are stable numbers; the harness produces the numbers first. CI runs a tiny-scale generation + measurement **smoke test** (the harness stays green) with no timing assertions.
- **The `loadtest` environment** (ADR-0075's named possible third environment — the harness against real Cloudflare infrastructure): deferred until absolute production numbers are needed; see the honesty clause (§3.4).
- **Cross-firm/fleet-scale simulation:** per-firm D1 isolation means per-firm volume is the unit that scales; fleet behavior is the migration runner's concern (already tested).

## 3. Architecture

The harness lives in **`@magna-carta/fixtures`** — it _is_ the third entry point of the existing engine, not a new package (golden rule 1: reuse before building). It rides everything the package already has: the one-seed `FixtureContext` (seeded faker + fixed clock + seeded identifiers; byte-identical replay, outbox-id exception documented), `createLocalPerFirmDatabase` over the `@magna-carta/database/node-sqlite` adapter, the production seeding guard, and the rule that **fixtures call real domain write-paths, never raw inserts** — volume data is valid by construction at any scale. A separate export path (e.g. `@magna-carta/fixtures/load-profile`) keeps the volume machinery out of the scenario/demo import surface.

### 3.1 Volume profiles

A **profile** is a declarative, named, versioned parameter object — counts and simple distributions, no code. V1 ships `ledgerVolume`: chart size and subledger fan-out, entry count, a lines-per-entry distribution, a reversal rate, and a posting span spread over the fixed clock (so `effective_date`/`recorded_at` queries see realistic time dispersion). Defaults are sized to a plausible established small firm (years of posting activity), with a single **scale multiplier** so the same profile runs at smoke scale (CI), working scale (local), and stress scale (deliberate runs). Distribution defaults are the implementation plan's to set; the design constraint is that they are **parameters of the profile, not constants in the generator**.

Profile versions are part of snapshot identity (§3.2): changing a profile is a new version, never a silent mutation — otherwise baselines measured against different data masquerade as comparable.

### 3.2 Snapshot & replay

Generating thousands of entries through real write-paths is deliberately not cheap — that is what makes the data valid. So generation runs **once per (profile version, seed, schema state)** and the result is snapshotted:

- **Artifact = the SQLite database file + a JSON manifest** recording profile name + version, seed, the schema migration state (journal tag), and the generator package versions. The white paper's R2-blob side of the artifact (documents at volume) joins in slice 1·1 when files exist.
- **Cache, don't commit.** Artifacts live in a gitignored local cache directory keyed by manifest identity. They are reproducible by construction (one seed), so the repo never carries megabytes of derived data; any machine regenerates on first use. A manifest mismatch (schema migrated, profile bumped, package upgraded) invalidates and regenerates — stale snapshots structurally cannot be measured against.
- **Replay = file copy.** Loading a snapshot is copying a SQLite file and opening it — milliseconds, so measurement runs and UI dev servers can demand a populated firm freely.

### 3.3 Measurement runner (query level, v1)

A **measurement** names an operation — a domain-service call or data-access read (`postEntry`, a balance read, a future matter-list query) — and the profile it runs against. The runner: load snapshot → warmup iterations → N timed iterations → report **median / p95 / min** per measurement.

Two outputs:

- **Timing baselines** — a small committed JSON baseline per (measurement, profile version) for human diffing across changes. Committed because they are tiny, textual, and reviewable; _not_ CI-gated (§2).
- **Query-plan capture** — `EXPLAIN QUERY PLAN` for the SQL each measured operation executes, with a structural check that flags full-table scans on measured paths. Plan shape is timing-noise-free and catches missing indexes and N+1 patterns directly (golden rule 10's "no N+1" has a mechanical detector from day one).

### 3.4 The honesty clause

Local `node:sqlite` is not production D1: no network hop, no Workers runtime, different engine build. Harness numbers are **relative** — regression deltas, growth curves as volume scales, plan shapes — never absolute production latencies. That is exactly what golden rule 10's decisions need (is this O(n)? did this change make reads 3× slower? is there a scan?). When absolute numbers are needed, the named seam is the `loadtest` environment (ADR-0075) running this same harness against real infrastructure; nothing in the design assumes local-only forever.

## 4. Determinism & safety

All inherited, none new: the one-seed rule (same seed → byte-identical snapshot, outbox-id exception as documented in the fixtures `CLAUDE.md`); the fail-closed production seeding guard (volume generation is still seeding — it can never run against production); demo-tenant-only data, purely synthetic; the fixtures package is never imported by production worker code (ADR-0070 boundary).

## 5. First consumers

1. **The slice 0·3 deferred efficiency candidates** — the first measurement set, settling read coalescing, prepared-statement caching, and chart-seed batching with evidence.
2. **Per-slice DoD perf-tests** — binding from the first slice to land after the harness.
3. **Slice 1·1** — matter/file volume profiles and the UI-density feed for the File Manager screens and the 0·7a catalog.

## 6. Left to the implementation plan

Default profile sizes and distributions; the cache directory convention; the baseline JSON format and diff ergonomics; the measurement-suite registration shape; the CI smoke-scale parameters.
