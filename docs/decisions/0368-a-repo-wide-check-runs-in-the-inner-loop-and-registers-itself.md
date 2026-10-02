---
number: 368
slug: a-repo-wide-check-runs-in-the-inner-loop-and-registers-itself
status: Proposed
date: 2026-08-16
area: Build & CI
summary: "A check that scans the whole repository is broken by a change made anywhere, so it never lives in the package the change touched — which makes a diff-scoped gate structurally incapable of running it. Three changes reached `main` red in one session through that hole while the whole-repo tier that would have caught all of them was unavailable. `pnpm check:scoped` therefore runs the repo-wide set itself, in two labelled steps: the derived governance lints always (~0.7 s, run concurrently), and a Vitest fitness sweep whenever the diff touches first-party source (~2.5 s, under its own config rather than the root workspace, which is 2.5 s against 8.5 s for the same files). Membership is derived rather than listed — the lints are enumerated from the `lint:*` scripts in the root package.json, and the fitness tests self-register with an `@repo-wide-fitness` directive in their own header — because a hand-maintained roster of repo-wide checks is the same bug one level up. Two lints are excluded with their numbers: `lint:licenses` (1.6 s, dependency-set-only, so it runs on a manifest or lockfile change) and `lint:test-collection` (26 s, CI's own job)."
---

**A repo-wide fitness function runs in the inner loop, and declares its own membership there.**

**Context:** In one session `main` went red three times, each on a different check, and every one was
missed the same way. A load-profile harness that prints measurements tripped the console ban, which lives
in `packages/telemetry`; a sweep of landed stream notes left five dangling `active-work` pointers, which
`lint:status` reads; a new table arrived unclassified against the PII registry, which lives in
`packages/data-access` while the schema lives in `packages/database`. None of the three diffs touched the
package holding the check that governed it — that is not bad luck, it is the definition of a repo-wide
check. The tier that would have caught all three is the whole-repo one, and that tier is exactly the one
that can be absent: GitHub Actions started no job for eleven days under an account billing block, and
`pnpm check` was OOM-killed at step one until its order was fixed. Relying on a gate somebody else runs is
not a gate. The checks themselves are cheap — the PII coverage assertion is 12 ms, a console-ban scan is
305 ms — so the hole was never about cost.

**Decision:** `pnpm check:scoped` gains two labelled steps. **`repo-wide lints`** runs unconditionally,
because the diff shape that breaks them is routinely docs-only; the twelve scans are spawned concurrently
as the commands their package.json scripts name (skipping ~600 ms of `pnpm run` startup each), so the step
costs ~0.7 s rather than the 1.7 s serial sum. **`repo-wide fitness sweep`** runs whenever the diff touches
first-party source under `apps/` or `packages/`, which is a sound precondition rather than a guess — every
member reads source or the Drizzle schema — and adds ~2.5 s. It runs under its own Vitest config, which is
2.5 s against 8.5 s for the same files because the root workspace resolves ~70 project configs before it
filters, and with `isolate: false`, which is safe because every member is a read-only scan. Membership is
**derived, not listed**: the lints are enumerated from the `lint:*` scripts in the root package.json (the
CI `governance` job calls the same runner with `--all`, so the two tiers cannot drift), and the fitness
tests self-register with an `@repo-wide-fitness` directive comment in their own header, with an optional
`scope=schema` for the ten whose only input is the Drizzle schema. Two lints are deferred with their
measured costs: `lint:licenses` (1.6 s, and only a dependency change can move it, so the inner loop runs it
on a manifest or lockfile change) and `lint:test-collection` (26 s, run by CI's own job).

**Considered & rejected:** _leaving the set to `pnpm check` and CI_ (that is the status quo, and it is what
produced three red merges in one session); _a hand-maintained list of members in the gate_ (the roster is
the same drift one level up — the next repo-wide check written will not be on it and nothing will say so);
_running the sweep through the root Vitest config_ (8.5 s against 2.5 s, all of it workspace resolution, on
a command people run dozens of times an hour); _making the sweep unconditional too_ (it would triple the
cheapest inner loop — a markdown edit — for coverage that is provably zero on a docs-only diff);
_narrowing the sweep's trigger to the package that owns each check_ (that is precisely the bug);
_registering the sweep config as a Vitest project_ (it would run every member twice in the whole-repo suite
and break the shard-union arithmetic in `lint:test-collection`, so `lint:test-registration` now knows the
shape and refuses it); _including `apps/worker`'s route-conformance suite_ (26 s, because it starts the
Miniflare pool — a real repo-wide check that is honestly too slow for the inner loop, and stays in CI);
_a heuristic that infers membership from a test file reading paths outside its own package_ (it matches
every fixture-loading test too, so it would need an opt-out list, which is a roster again).

**Consequences:** The inner loop is slower and says so: measured warm on a development machine, a
markdown-only diff moves from ~0.9 s to ~1.6 s, one source file from ~2.3 s to ~4.9 s, and a
`packages/database` schema file from ~4.7 s to ~7.8 s. The three failures were each reproduced
deliberately against the wired gate before this landed. Writing a repo-wide check now carries one
obligation — the directive comment — recorded in [`testing.md`](../conventions/testing.md); the tier's
budget and boundaries are in [`build-performance.md`](../conventions/build-performance.md). Builds on
**ADR-0078** (fast feedback is a foundation, added up front) and **ADR-0051** (fitness functions as the
enforcement idiom).
