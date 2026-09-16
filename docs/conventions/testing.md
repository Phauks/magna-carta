# Testing conventions

**Status:** Framework decided (ADR-0041); layer details + CI gates filled in during Phase 0.

**Scope (single home for):** how Magna Carta is tested — the test layers and their tools, where test data comes from, and determinism rules.

**Authoritative context:** the white paper — _Synthetic data & fixtures_ (test data) and _Design system_ (visual regression) and _Development guidelines_ (tooling).

## Layers & tools

- **Unit + component (behavior)** — **Vite+ integrated testing** (the Vite+ toolchain's test runner, Vite-native). Svelte components test against the same SvelteKit pipeline with no extra build config: assert props, events, state, and **accessibility**. This is the standard place a component's _behavior_ is verified (visual-regression below catches _appearance_).
- **Integration** — Vite+ testing against **Miniflare** (local D1 + R2), exercising Workers/API and the domain write-paths.
- **End-to-end** — **Playwright**.
- **Visual regression** — **Playwright** screenshots over the **Storybook** component catalog, across every theme×mode, baselines generated in the pinned Playwright Docker image (Argos CI the named upgrade); catches cross-component drift (design-system enforcement, white paper _Design system_; ADR-0076).

A component is properly covered when it has: a **catalog entry** (definition/review), **behavior tests** (Vite+), and is under **visual-regression** — appearance _and_ behavior, not one or the other.

## Test data

- **Fixtures via domain write-paths only** — typed factories calling real service APIs; never raw SQL inserts (would bypass ledger/trust/conflicts invariants). See the white paper _Synthetic data & fixtures_.
- **Determinism:** single injectable seed, fixed clock, seeded IDs; `crypto.randomUUID` and wall-clock time banned in fixtures.
- The three fixture entry points: asserted **scenarios** (`trustOverdraftBlocked`, `conflictHit`, three-way reconciliation), **demo-firm bundle**, **load profile**.
- Fixtures **never run in production** (guarded).

## Work that outlives the test

A response is not the end of the work. Handlers deliberately push work off the response path
(`executionCtx.waitUntil`), and a test that asserts on the response returns while that work is still
running. When the last test in a file returns, the harness tears the environment down — and the
background work is mid-conversation with the test host, because resolving a module on first use and
emitting a structured log line are both calls to it. Those calls are closed underneath the work and
reject into a promise nobody holds, so the run fails on an error no test produced, in a file that
passed. Whether it lands at all depends on how far the work happened to get, which is why it
presents as a flake and why unrelated changes appear to cause or cure it.

**The rule: background work is waited for, never suppressed.** An unhandled-rejection handler, an
expected-warning marker, or anything else that hides the teardown error leaves the work racing the
teardown and only removes the evidence.

Every piece of fire-and-forget work therefore goes through a helper that accounts for it, and the
harness waits for the count to reach zero after each test. In the Worker that is
`trackBackgroundWork` / `runInBackground` (`apps/api-worker/src/background.ts`) and the global
`afterEach` barrier in `apps/api-worker/test/support/settle-background-work.ts`, registered for every
file through `setupFiles`. A new fire-and-forget path that skips the helper is invisible to the
barrier, which is the one way to reopen this: the barrier's own test
(`apps/api-worker/test/background-work-barrier.test.ts`) proves it can still see work being started, so
a barrier that has quietly become vacuous fails rather than passing instantly.

Waiting is a poll on a counter rather than an `await` of the promises, because the work runs in the
I/O context of the request that started it: awaiting across that boundary is refused by the runtime
("Cannot perform I/O on behalf of a different request").

## Injected dependencies: one test builds the composition root as production does

A test that injects a dependency has decided what that dependency is. Where production supplies
something else — a placeholder that throws, a resolver that returns nothing, an absent binding — the
suite is green about a path no member can walk, and the greener it is the longer that lasts. Shipping
shipped exactly that: the end-to-end test injected a working in-memory credential store, production
wired a builder that threw while the integration registry was assembled, and a member could create a
shipment draft, fail to buy it with a server error, and be told by that error to connect a carrier
account — which failed the same way. The source file documented the seam in a comment directly above
the throw. What was missing was not the knowledge; it was a test that had ever asked.

**The rule: every injection seam has at least one test that supplies nothing and asserts what a real
request gets.** Build the app the way `index.ts` does — no overrides — drive the surface, and assert
the actual status and body. The assertion is the point even when the answer is good: an honest
refusal that nothing pins is one edit away from becoming a `500`.

Two things follow from it.

- **A deferred backing is a typed outcome, never a throw at the seam.** A throw where the dependency
  is constructed happens before anything can classify it, so the mapping a route already carries is
  unreachable and the member gets an Error ID for a thing the platform knows the answer to. The
  vocabulary already exists and is not to be reinvented per subsystem: `engine-not-implemented`
  (`packages/conversion/src/port.ts`, `packages/search/src/port.ts`),
  `credential-store-not-implemented` (`packages/integrations/src/dispatch.ts`), `ScanFaultError`
  (`packages/file-manager/src/verdict.ts`). Map it to a status whose registered contract in
  `apps/api-worker/src/contracts/problem-types.ts` is actually true — `service-unavailable` promises a
  deploy clears it, `not-implemented` does not.
- **A stub service binding in the test pool is a test double too.** `apps/api-worker/vitest.config.ts`
  registers a stub worker for every service binding, and a stub that answers correctly proves only
  that the route works against a healthy service. The state a deployment actually spends time in is
  bound-but-unreachable — a placeholder worker, a Container that is not up — so drive that case by
  passing a failing binding in the request's env, not by trusting the stub.

Seams that genuinely have no production placeholder — a clock, a seed, a network adapter whose
production form is the real network — need no such test, and saying which ones those are is part of
the review, not a step skipped in silence.

## Owner manual verification checklist (UI slices)

Every slice that ships UI also ships a **manual verification checklist** — a definition-of-done deliverable, owner-directed (2026-06-11, slice 1·1 design cycle). It is a short document of concrete, clickable walkthrough steps the owner performs to visually confirm the feature behaves as intended (e.g. "create a year-scoped numbering scheme; confirm the live preview renders `2026-0001`; create a consultation; confirm it has no number and appears in your Consultations folder"). It complements — never replaces — the automated layers above: automated tests prove the code's behavior; the checklist gives the owner a structured visual pass over the product's behavior. Checklists live with the slice's docs in [`docs/specs/`](../specs/) (one per slice, written during the build, kept current with UI changes).

## The 7-angle adversarial review (run during build / before a branch merges)

Every package or vertical slice gets an **adversarial review with empirical verifiers** once its tasks land and before it merges — this is what `STATUS.md`'s **Built** column means (implemented _and_ reviewed; review is not a separate column). It is not a prose read-through: each finding is **proven by a runnable verifier** (a focused test, a `grep`/source scan, a fault-injection, a migration apply) — evidence, not assertion. The pass attacks the change from seven angles; each slice instantiates them for its own domain (the ledger slice's "batch-atomicity edges / append-only source scan", the load-profile slice's "generator realism / snapshot-identity holes" are domain instances of the same frame):

1. **Correctness & edge cases** — boundary inputs and partial-failure injection; the unhappy paths, not just the happy one.
2. **Concurrency, ordering & idempotency** — races, retries, at-least-once redelivery, double-apply windows (queue consumers, effect batches, outbox). Technique and harness: _Concurrency: choose the interleaving, and prove it happened_, below.
3. **Determinism & reproducibility** — behavior under clock / locale / seed / platform variation; no wall-clock or unseeded randomness where reproducibility is required.
4. **Boundary & public surface** — the exports map / no-barrel discipline, a minimal public API, and type-consistency of shared names across the modules that define and consume them.
5. **Invariant & constraint coverage** — domain invariants and DB CHECK/PK/index coverage matched against the spec; fitness functions that assert the real rule, not a mock.
6. **Static fitness scans** — source-scan guards: append-only tables, forbidden patterns, `lint:process-refs` (golden rule 13), full-name discipline (golden rule 12), purity/no-cross-firm.
7. **Security & tenancy isolation** — privilege/confidentiality (redaction, no privileged content in logs/errors), firm-scoping (no query or handle crosses firms), and secret handling. Instantiate this angle from the vendored attack taxonomy in [`.claude/skills/security-audit/`](../../.claude/skills/security-audit/) (`ATTACK-CLASSES.md`, `HUNTING.md`): pick the classes the slice's surface actually exposes — a slice with outbound HTTP runs the SSRF / feature-abuse and chained-attack classes; a write-path slice runs access-control and business-logic — so the security angle is a concrete checklist, not a prose read.

Run it as a fan-out of independent reviewers (one per angle, or grouped), each returning findings with a `file:line` and the verifier that proves it; fix findings and update docs in the same pass. A finding without a runnable verifier is a hypothesis, not a result.

## Concurrency: choose the interleaving, and prove it happened

There is no interactive transaction here. A domain mutation reads its precondition in one round trip and commits its batch in another, so the read is advisory by the time the write runs — two callers can both read the same pre-state and both commit. The batch's atomicity does not stop that. What stops it is a UNIQUE or CHECK constraint that aborts the batch, or a guarded UPDATE whose WHERE repeats the precondition so a stale caller changes no rows.

That guard is what a concurrency verifier has to exercise, and the read in front of it is why this needs a tool. A service that checks a status and then commits reads as though it enforces that status. Delete the `AND status = 'draft'` from the statement and every ordinary test still passes, because none of them ever arranged for the status to change in between.

**Where the contended state is inside a Durable Object, fire two real calls.** The DO serializes them, so `Promise.all` before awaiting either is an honest race — `apps/api-worker/test/firm-database/firm-database-concurrency.test.ts` and `test/live-timer-do.test.ts` are the templates.

**Everywhere else, place the competing writer at a named point** with [`@magna-carta/data-access/interleave`](../../packages/data-access/src/interleave.ts). Racing two promises against a read-then-commit service interleaves them however that run happened to schedule them: the test passes for a reason nobody chose, and stops failing for a reason nobody notices.

```ts
await runInterleaved({
  database,
  concurrentWriter: () => billOutsideTheService(database, id),
  operation: (racing) =>
    commit(racing, updateDraftFee(racing, id, { amountMinor: 999_999 }, options)),
});
```

`beforeCommit(nth)` is the default point and fits any mutation that reads and commits in one call. `afterRead(matching, occurrence)` fires once a read whose SQL contains `matching` resolves, and is for an operation that does other work in between — the retroactive re-rate makes one rate-resolution round trip per candidate before committing them all, so its window is the whole span rather than the commit.

**`runInterleaved` throws when the point was never reached, and that refusal is the point of using it.** A concurrency verifier whose competing writer never ran still exercises the operation, still asserts whatever it asserted, and still passes — it has become a single-caller test wearing a concurrency test's name, and nothing about it looks wrong on the day the guard it was meant to pin is deleted. The shape to watch for is a test asserting a rejection that came from a precondition the operation never got past; the operation's own failure survives on the error as `operationFailure`, so reading it costs nothing.

**A guard that holds the data can still misreport, so assert what the loser is told.** This is what the first verifiers written with the harness turned up: the fee freeze and the cost billing lock both protected the row and both answered `200`, because the affected-row count never left the batch seam — and the audit statement riding the same batch, carrying no precondition of its own, recorded an edit that had been refused. Both are fixed: a statement marked `guarded(statement, label)` now aborts its transaction when it affects no rows, which takes the audit row and the outbox message with it. So a concurrency verifier asserts three things, not one — the row did not move, the caller was refused, and nothing was recorded.

**The gate is `pnpm run lint:guarded-writes`** ([`tooling/lint-guarded-writes/`](../../tooling/lint-guarded-writes/)), discovered automatically by `check:scoped` along with every other `lint:*` script. It enforces four rules: a builder wrapped in `guarded()` at one call site is wrapped at all of them; an exemption states a reason; a test reaching for `interleaveAt` rather than `runInterleaved` asserts `.interleaved`; and nobody re-implements the harness locally. That last one was not hypothetical — it found a third copy, in the trust close-precondition tests, on its first run. Guard-shaped builders nothing wraps are counted on a passing run rather than failed: around a hundred and thirty exist, marking them blind would assert a review nobody has done, and each becomes a hard failure the moment one call site marks it.

## A repo-wide fitness function declares itself repo-wide

A fitness function whose jurisdiction is the **whole repository** — it scans every package's source, or
pins a registry against a schema owned elsewhere — cannot live in the package whose code it governs, and
that is what makes it dangerous. The diff that breaks it is routinely in a package that has never heard of
it, so a diff-scoped gate runs everything except the check that would have caught the change. Three
changes reached `main` red in one session that way.

So the rule is: **when you write a fitness function that a change made anywhere can break, say so in its
header.**

```ts
// @repo-wide-fitness — scans apps/*/src and packages/*/src, so any package's diff can break it.
```

That one comment is the whole registration. `pnpm check:scoped` discovers members by scanning for the
directive and runs them in one process on every diff that touches source; nothing else has to be edited,
and there is no list to forget. A check whose only input is the Drizzle schema declares
`scope=schema` instead, so it triggers on a `packages/database` change rather than on all source. The
mechanism, the cost budget, and what qualifies live in
[`tooling/check-scoped/repo-wide.mjs`](../../tooling/check-scoped/repo-wide.mjs) and
[`build-performance.md`](build-performance.md).

The converse also matters: **do not mark a fitness function repo-wide when its only possible input is its
own package's source.** Those are already covered — the diff that breaks one is the diff that reaches it —
and marking them only makes the inner loop slower for no coverage.

Where to put a repo-wide check is unchanged: it lives with the rule it enforces (the console ban belongs
to `packages/telemetry`, which owns the one logging path). The directive is how the gate finds it, not a
reason to move it.

## Whole-repo security audit

The 7-angle review is scoped to a slice's diff, so it structurally cannot see exploit chains that cross slice boundaries — an SSRF in one package reaching a tenancy gap in another. A periodic **whole-repo** adversarial security audit covers that ground, run via the vendored [`security-audit`](../../.claude/skills/security-audit/) skill (Cloudflare, MIT): a multi-agent recon → hunt → validate → independent-verify pipeline where the agent that validates a finding is never the one that found it. It is **not** a merge gate — its coverage is probabilistic (roughly half the findings surface in any single run, so run it more than once and let it read prior runs' `findings.json` to skip known issues). The 7-angle stays the deterministic gate; this is the periodic depth pass behind it.

**Evidence standard — same rule as the 7-angle, and it is the close-out condition.** An audit is not done when the report lands. Every **confirmed** finding becomes a runnable regression verifier — a focused test, fault-injection, or source scan that fails today and passes once fixed — committed alongside the fix. A finding that exposes a systemic gap also becomes a standing **fitness function** (angle 6) and an **ADR**. A confirmed finding without a committed verifier is a hypothesis, not a result.

**Confidentiality.** Audit artifacts quote source and spell out live attack paths — treat them as privileged. Point the skill's output directory outside the repo (and out of any third-party service); never commit raw reports or `findings.json`. (Golden rule 4.)

## To detail (Phase 0)

- TDD expectations and the CI gate (what must pass to merge).
- Coverage targets and where they apply.
- Vite+ test config specifics (environment, when to use real-browser component testing vs. simulated DOM).
