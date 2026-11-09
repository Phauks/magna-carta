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

**`pnpm run lint:catalog-coverage` holds that definition.** The unit is the component **family** — a directory under `packages/design-system/src/lib/components/`, which is also what the package's `exports` map names one subpath each — not the file: a compound component exports its parts by design (`DataTable` alone ships sixteen `.svelte` files as its namespace), so a per-file rule would open with a 173-entry register of parts the family's own story already photographs. That is a form to fill in, not a debt to pay. 79 of 83 families have an entry of their own; the four that do not are the register.

Coverage means the story that entry is **about** — its file name, or the component `defineMeta` names — never a component that merely renders inside someone else's story. Rendered-somewhere is enough for a screenshot to move and not enough for a person to find the component, and not finding it is how the second implementation gets built. The behaviour leg is checked from either side (the story's own `storybook/test` assertions, which 87 of 91 stories carry, or a unit test that imports the family) and is clean. The visual-regression leg is not per-component checkable and is not pretended to be: `visual-regression/catalog.spec.ts` holds no component list at all — it derives its matrix from the built catalog at run time — so what the gate asserts is that the derivation is still there, which makes leg three a consequence of leg one.

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
`trackBackgroundWork` / `runInBackground` (`apps/api-worker/src/http/deferred-work.ts`) and the global
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
  `apps/api-worker/src/http/contracts/problem-types.ts` is actually true — `service-unavailable` promises a
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
7. **Security & tenancy isolation** — privilege/confidentiality (redaction, no privileged content in logs/errors), firm-scoping (no query or handle crosses firms), and secret handling. Instantiate this angle from the vendored attack taxonomy in [`.claude/skills/security-audit/`](../../.claude/skills/security-audit/): `ATTACK-CLASSES.md` and `HUNTING.md` carry the core classes, and the domain companions beside them carry the rest — `DATA-ISOLATION-AND-LIFECYCLE.md` for anything that reads or writes per-firm data (a tenant column is not isolation; the query, key, or path that binds it is), `CLOUD-AND-DEPLOYMENT.md` for a binding, secret, or `wrangler` change, `SUPPLY-CHAIN-AND-RELEASE.md` for a dependency or container change, `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` for a Queue, Durable Object, or Container path, `AI-AND-LLM.md` for Magnus, `CLIENT-SIDE.md` for the web app, and `DESKTOP-MOBILE-AND-LOCAL-IPC.md` for the Tauri shell. Pick the classes the slice's surface actually exposes — a slice with outbound HTTP runs the SSRF / feature-abuse and chained-attack classes; a write-path slice runs access-control, business-logic, and tenant-isolation — so the security angle is a concrete checklist, not a prose read.

Run it as a fan-out of independent reviewers (one per angle, or grouped), each returning findings with a `file:line` and the verifier that proves it; fix findings and update docs in the same pass. A finding without a runnable verifier is a hypothesis, not a result.

## Concurrency: choose the interleaving, and prove it happened

There is no interactive transaction here. A domain mutation reads its precondition in one round trip and commits its batch in another, so the read is advisory by the time the write runs — two callers can both read the same pre-state and both commit. The batch's atomicity does not stop that. What stops it is a UNIQUE or CHECK constraint that aborts the batch, or a guarded UPDATE whose WHERE repeats the precondition so a stale caller changes no rows.

That guard is what a concurrency verifier has to exercise, and the read in front of it is why this needs a tool. A service that checks a status and then commits reads as though it enforces that status. Delete the `AND status = 'draft'` from the statement and every ordinary test still passes, because none of them ever arranged for the status to change in between.

**Where the contended state is inside a Durable Object, fire two real calls.** The DO serializes them, so `Promise.all` before awaiting either is an honest race — `apps/api-worker/test/firm-database/firm-database-concurrency.test.ts` and `test/live-timer-do.test.ts` are the templates.

**But only a STORAGE await holds a Durable Object's input gate.** That is what makes an ordinary read-then-write in one atomic without anybody asking: a second call is not delivered until the first has written. Await anything else in that window — an R2 HEAD, a queue send, a service binding — and the gate opens, both callers read the old state, and both act. Nothing in the source says so, which is why it is a scan rather than a review note: `pnpm run lint:durable-object-gates`. It found one on its first run, where deciding whether a reaped bundle needed rebuilding meant a HEAD against R2, so two requests for the same expired bundle each enqueued a full rebuild. `ctx.blockConcurrencyWhile` around the decision is the remedy, and `LiveTimerDurableObject.stopAndCommit` is the worked example.

**A property test asks the question a pair cannot.** Two callers never lose five races in a row, so no two-caller test can see a bound that only bites at higher concurrency. `packages/matters/test/number-draw-linearizability.test.ts` drives N draws at once and checks the whole set: correctness is absolute at every N (distinct, gapless), convergence is bounded by the retry budget, and the measured ceiling is pinned so a change to that budget is visible. `packages/ledger/test/concurrent-posting-linearizability.test.ts` does the same for postings, with the domain's own fitness queries as the oracle — seeded, so a failure names a seed rather than a mood, and with no dependency added to run a loop.

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

**The gate is `pnpm run lint:guarded-writes`** ([`tooling/lint-guarded-writes/`](../../tooling/lint-guarded-writes/)), discovered automatically by `check:scoped` along with every other `lint:*` script. Five rules: every guard-shaped builder has been decided about; a builder wrapped in `guarded()` at one call site is wrapped at all of them; an exemption states a reason; a test reaching for `interleaveAt` rather than `runInterleaved` asserts `.interleaved`; and nobody re-implements the harness locally. That last one was not hypothetical — it found a third copy, in the trust close-precondition tests, on its first run.

**A guard-shaped statement is making a claim, so say what it claims.** Its WHERE carries more than the row's identity, which means matching no row means _something_ — and there are only two somethings. Either the act was refused, in which case the statement is `guarded()` and the batch rolls back so the caller hears about it; or a zero is an outcome somebody wanted, in which case it carries `// fitness:unguarded-write — <reason>` saying which. The reasons that came out of triaging the original 134 are worth knowing, because they are the shapes you will meet again: an at-least-once replay whose second delivery is meant to write nothing; a claim that expects to be lost sometimes; a mirror column whose real guard is a unique index elsewhere; a set-shaped update where zero is an empty set; a statement riding a batch whose sibling already carries the guard; a probe that matches nothing in the happy case; and partial progress by design, where a re-rate visiting a hundred entries must skip the one that got billed rather than abort the other ninety-nine.

## Concurrency in the browser: an answer may arrive after it stopped being wanted

Nothing here touches a database, and it is the same class of bug. A screen reads on a subject, the person picks another, a second read starts, and both resolve — in whichever order the network chose, which is often the wrong one. Whichever lands last writes the state, so the screen shows the previous matter's rows under the current matter's heading and looks exactly like a screen that loaded correctly.

**Reads go through `LatestOnly`** ([`apps/web/src/lib/api/latest-only.ts`](../../apps/web/src/lib/api/latest-only.ts)): `begin()` when a read starts, `supersede()` when the screen is cleared without one, and `attempt.current` checked before the answer is written. Aborting the older request is worth doing and is not a substitute — an abort can arrive after the response did, it does nothing for a read made of several calls, and it cannot stop an answer already sitting on the microtask queue. `pnpm run lint:stale-response` fails a file that grows its own counter instead; it found a fifth copy on its first run, under a different field name from the four that were known.

**Writes that must not happen twice hold a `WriteIntent`** ([`apps/web/src/lib/api/write-intent.ts`](../../apps/web/src/lib/api/write-intent.ts)). A double click is already handled wherever a control sets its in-flight flag synchronously — `if (saving) return; saving = true` with no await between is atomic, because the event loop is. The case that is not handled is the **retry after an ambiguous failure**: `writeKey()` is called inside the attempt, so a retry mints a different key, and a write the server committed before its response was lost is recorded a second time. A `WriteIntent` keeps one key across every attempt at one intent and rotates only after a success, so the retry replays through the idempotency machinery that is already there. The cost record window is the worked example.

**A test that resolves one read at a time proves nothing about either.** Resolve two out of order — `latest-only.test.ts` and `write-intent.test.ts` are the shapes.

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

The 7-angle review is scoped to a slice's diff, so it structurally cannot see exploit chains that cross slice boundaries — an SSRF in one package reaching a tenancy gap in another. A periodic **whole-repo** adversarial security audit covers that ground, run via the vendored [`security-audit`](../../.claude/skills/security-audit/) skill (Cloudflare, MIT; the pinned upstream commit and the refresh procedure are in its `VENDORED.md`): a multi-agent recon → coverage-led hunt → validate → independent-verify pipeline where the agent that validates a finding is never the one that found it. Ask for it explicitly — "audit this codebase", "pen-test", or "a full security review" — because the skill runs in **guidance mode** for any narrower security question and then writes no files and runs no phases. It is **not** a merge gate — its coverage is probabilistic (roughly half the findings surface in any single run, so run it more than once and let it read prior runs' `findings.json` and `coverage-ledger.json` to skip known issues and target what no run has checked). The 7-angle stays the deterministic gate; this is the periodic depth pass behind it.

**Three verdicts, and only one carries a severity.** A `confirmed` finding has a complete source trace and a bounded observed result. A `needs_validation` record names the one exact fact the auditor could not resolve, carries no severity, and lands in `NEEDS-VALIDATION.md`; it is a lead to close, not a finding to file. A `rejected` record is a disproved candidate, kept so the next run does not rediscover it. The skill executes target code (a build, a test, a fixture) only inside an OS-enforced sandbox with no network, an allowlisted environment, and a read-only target; where the session cannot provide that, it keeps the lead as `needs_validation` with a validation plan instead of running the code, which is the correct outcome and not a gap to work around.

**Evidence standard — same rule as the 7-angle, and it is the close-out condition.** An audit is not done when the report lands. Every **confirmed** finding becomes a runnable regression verifier — a focused test, fault-injection, or source scan that fails today and passes once fixed — committed alongside the fix. A finding that exposes a systemic gap also becomes a standing **fitness function** (angle 6) and an **ADR**. A confirmed finding without a committed verifier is a hypothesis, not a result.

**Confidentiality.** Audit artifacts quote source and spell out live attack paths — treat them as privileged. Point the skill's output directory outside the repo (and out of any third-party service); never commit raw reports or `findings.json`. (Golden rule 4.)

### The routine (canonical configuration)

The audit runs weekly as a Claude Code cloud **Routine** — the same shape as the docs-sync routine in [`../maintenance/README.md`](../maintenance/README.md): a clock outside the repo, everything it needs in-repo, so it can be deleted and re-created losslessly from this block. Created 2026-09-17 and enabled.

- **Name:** `MC - Security Audit`
- **Schedule (cron, UTC):** `0 13 * * 3` (Wednesdays 13:00 UTC — a day apart from the Monday docs and dependency routines, so two proposing runs never open pull requests into the same review window)
- **Session mode:** fresh session per firing. There is no carried context and no committed report, so the run's **only memory is the remediation pull requests it opened before**: branches named `remediate-<YYYY-MM-DD>-<slug>`, open or merged, read before hunting so effort goes to new ground. A coverage ledger is written per run and never committed, which is a known limit: what a run chose not to check is remembered only in that run's notification.
- **Notifications:** push + email on completion. The final message is the run's record — source ref, coverage summary, confirmed findings with pull request links, needs-validation leads with their one unresolved fact and a safe validation plan, what the codebase does well, and the run's agent cost.
- **What it may do:** open one pull request per confirmed finding from a `remediate-` branch, carrying the smallest effective fix, a runnable regression verifier, and a `changelog.d/` fragment (`Security`, `internal`). It never merges, never commits an audit artifact, never opens an issue with the report, and never probes a deployed endpoint or a live Cloudflare resource.
- **Execution:** the cloud session cannot provide the OS-enforced sandbox the skill requires to run target code, so the routine is source-analysis only, and a lead whose decisive fact needs execution lands as `needs_validation`. That is the correct outcome, not a failure of the run.
- **Prompt:** the full text is stored on the Routine; it restates the rules above as standalone instructions and points the session at `.claude/skills/security-audit/SKILL.md` on `main` and at this section as the binding policy.

**Changing cadence:** edit the Routine's cron in the Claude Routines UI (or ask a session to `update_trigger`). **Pausing:** disable the Routine. **Running off-schedule:** fire it from the UI, or ask any session on this repo for a full security audit with the same delivery rules. **Reviewing a remediation pull request:** the verifier is the evidence; read it first, then the fix, and treat the description's invariant claim as the thing to check.

## To detail (Phase 0)

- TDD expectations and the CI gate (what must pass to merge).
- Coverage targets and where they apply.
- Vite+ test config specifics (environment, when to use real-browser component testing vs. simulated DOM).
