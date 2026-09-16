# Testing for race conditions

**Status:** Research, partly acted on. A survey of where races can exist in this system, what already pins them, and which techniques are worth adopting.

Techniques 1 through 6 have since been built, and each is documented in [`docs/conventions/testing.md`](../conventions/testing.md) with its reasoning in a decision record.

Four things the survey did not anticipate are worth recording against it. The interleaving harness earned its keep immediately, finding that a guarded write protected its row and still answered `200` while the audit statement beside it recorded an edit that had been refused. The guarded-write census said 75 bare against 83 guarded from a grep; the fitness function, reading composed SQL, counts about 130 guard-shaped builders, and the grep undercounted. The Durable Object scan found a real single-flight hole on the one path that decides across an R2 round trip. And the number-draw property test found a ceiling no two-caller test could see: five concurrent draws converge, and beyond that the excess is refused — correctly, distinctly and gaplessly, but refused.

Two corrections to the survey's own claims. It said the `#generation` stale-answer guard existed in exactly one file; there were five, the fifth under a different field name, and the lint is what found it. And it said a client double-click produces two effects — a double click is already prevented wherever an in-flight flag is set synchronously, because the event loop makes check-and-set atomic. The real defect is the retry after an ambiguous failure, which mints a fresh key and records the thing twice.

Techniques 7 (stress and soak) and 8 (Rust under `loom` or ThreadSanitizer) are still proposals, for the reasons recorded below. The findings and the ranking are kept as written, because what a survey concluded before anything was built is worth reading against what building it turned up.

**Date:** 2026-09-16

## Why this is not the usual race-condition problem

"Race condition" in most codebases means shared mutable memory across OS threads, and the tooling that goes with it — ThreadSanitizer, `loom`, lock-order checkers — exists to find data races in that model. Almost none of that applies here, and saying why is the first useful result, because it tells you which tools not to buy.

The TypeScript side runs on workerd. Every isolate is single-threaded with a run-to-completion event loop, so there is no data race in the memory sense: no torn reads, no lost writes to a JavaScript object, no need for a mutex over a variable. Interleaving happens only at `await` points, and only between independently-scheduled tasks. What can race is **state outside the isolate** — a row in a per-firm SQLite database, an object in R2, a key in Durable Object storage, a queue message — reached by two requests whose await points straddle the same window.

So the entire race surface reduces to four substrates, and each has a different failure mode and a different test technique:

1. **Per-firm SQLite inside the `FirmDatabase` Durable Object**, reached over RPC (`apps/api-worker/src/firm-database/firm-database-object.ts`). The DO serializes each RPC, and `commitBatch` is `storage.transactionSync` — all-or-nothing (`packages/database/src/do-sqlite-batch-database.ts`). There is **no interactive transaction**, so a read and a later write are two separate RPCs with a real window between them.
2. **Durable Object coordinators** — eleven of them (conversion, document session, magnus conversation, assembly, bundle, discovery load, search compaction, search index, live timer, recovery, plus `FirmDatabase`). A DO's input gate closes across a _storage_ await but not across an arbitrary `await` (a `fetch`, a service binding, a queue send), so a method that awaits external I/O mid-way can be re-entered.
3. **Queues**, which are at-least-once by contract. Every consumer must be idempotent, and the same message can be in flight twice.
4. **The browser** — 151 `.svelte` files use `$effect`, and async loads resolving out of order are the classic stale-write race. This is a real race class even though it never touches a database.

The Rust crates are the one place the conventional model applies: `rayon` in `crates/decryption-core` (`dictionary.rs`, `recover.rs`) and `std::thread::spawn` / `tokio::spawn` in `crates/pdf-eval` and `crates/engine-host`. That is a small, bounded surface with its own answer, below.

## The systemic race class: read outside the batch, write inside it

This is the one worth naming on its own, because it is architectural rather than incidental.

Every domain mutation follows the same shape: read the current state to check a precondition, compute, then commit one atomic batch through `runDomainEffect` / `runIdempotentEffect` (`packages/data-access/`). The batch is atomic. The **read is not part of it**. Two requests can both read the same pre-state and both commit, and the batch's atomicity does nothing about it, because each batch is internally consistent and they are inconsistent with each other. That is a lost update or a time-of-check-to-time-of-use violation depending on what the precondition was.

The architecture already knows this and answers it three ways, all of which push the decision _into_ the batch where the transaction can see it:

- **A UNIQUE constraint that aborts the batch.** The idempotency record goes first in the batch precisely so its `UNIQUE(key)` conflict aborts before any business statement runs (`packages/data-access/src/effect-batch.ts`). The custody and matter number draws use an allocation table's primary key the same way; the loser aborts and its retry re-reads the advanced counter.
- **A CHECK constraint.** The no-negative trust balance is enforced by `min_balance_minor = 0` and the `account_balance` bounds CHECK, and [`docs/conventions/invariants.md`](../conventions/invariants.md) says explicitly that it is never enforced by an application-level balance comparison, "which cannot be atomic without an interactive transaction." That sentence is the whole design rule.
- **A guarded UPDATE that branches on `meta.changes`.** `UPDATE ... WHERE id = ?1 AND status = 'open'` is a compare-and-set; zero rows changed means somebody else got there first. The outbox relay, the fee and cost entry state machines, the shipment label claim and the reconciliation close all do this.

So the question for testing is not "is the pattern known" — it plainly is — but **which write paths actually carry a guard and which quietly do not**. A rough census of `packages/*/src`: of 253 composed `UPDATE` statements, 83 key on `id` plus a further predicate (guarded), 75 key on `id` alone, and 95 have some other `WHERE` shape. The 75 are not 75 bugs — many update a row whose precondition is immutable, or ride a UNIQUE elsewhere in the same batch — but they are the population that has never been triaged, and nothing today tells a reviewer which is which.

## What already exists

The inventory is better than I expected going in, which changes the recommendation from "start testing for races" to "generalize what three or four slices already do."

**The 7-angle adversarial review already makes this angle 2** — "Concurrency, ordering & idempotency — races, retries, at-least-once redelivery, double-apply windows (queue consumers, effect batches, outbox)" — and requires every finding to come with a runnable verifier ([`docs/conventions/testing.md`](../conventions/testing.md)). The frame is in place; what is missing is a shared tool the angle can reach for, so each slice reinvents one.

**Roughly 35 test files exercise a concurrency shape.** The genuinely race-named verifiers (about 25 of them) cluster into three techniques:

- **True concurrent dispatch against a real Durable Object.** `apps/api-worker/test/firm-database/firm-database-concurrency.test.ts` fires two identical idempotent effects with `Promise.all` before awaiting either, and asserts exactly one `executed` and one `replayed`, one outbox row, one idempotency record — and that the same key in two firms both execute, so the tenant boundary is part of the same test. `apps/api-worker/test/live-timer-do.test.ts` does the same for two concurrent `stopAndCommit` calls. This works because both run inside Miniflare against a real DO.
- **Redelivery replay.** About fifteen tests drive a queue consumer twice with the same message and assert one commit, one meter, one audit row, one emitted event — ingest, inference, magnus, discovery, costs recovery, notifications, document automation, email capture and auto-file, scheduled provisioning. `apps/api-worker/test/ingest-consumer.test.ts` goes further and interleaves two deliveries rather than running them in sequence.
- **Deterministic interleaving via a wrapped database.** `packages/matters/test/matter-service.test.ts` defines `interleaveBeforeFirstCommit(database, before)` — a `BatchDatabase` proxy that runs an arbitrary concurrent writer the first time `batch()` is called, so the window between the precondition read and the commit is opened on purpose rather than by luck. Its own comment states the reason: "D1 has no interactive transaction, so that window is real; running `before` at the first batch makes it deterministic instead of dependent on how two promises happen to interleave."

That last helper is the most valuable thing in the repository for this purpose and it currently lives in one test file for one package.

**Supporting infrastructure that makes race tests cheap:** `packages/data-access/test/support/stub-d1.ts` can script `meta.changes` per statement and force a whole batch to fail, which is how you simulate losing a race without needing a second writer at all. `createMigratedNodeDatabase` gives a real migrated SQLite database in a pure-node test. The background-work barrier (`apps/api-worker/test/support/settle-background-work.ts`) already solves the adjacent problem of `waitUntil` work racing test teardown, and the rule it encodes — background work is waited for, never suppressed — is exactly the right instinct applied to a different race.

## Gaps

**The interleaving harness is not shared.** One package has it. Every other read-then-commit service — `packages/costs`, `packages/fees`, `packages/timekeeping`, `packages/file-manager`, `packages/custodian`, `packages/calendar`, `packages/locations`, at least fourteen `*-service.ts` files read then write — would have to reinvent it.

**No fitness function distinguishes a guarded write from an unguarded one.** The repo has over thirty source-scan lints (`tooling/lint-*`) including several that enforce exactly this kind of structural property — `lint-unwired-writes`, `lint-ledger-staleness`, the append-only scans. There is no equivalent asking "this statement updates a row whose precondition was read in a separate round trip; where is the guard." The `@repo-wide-fitness` directive mechanism means adding one is a single comment plus a test file.

**Durable Object re-entrancy across non-storage awaits is unpinned.** `blockConcurrencyWhile` is used in exactly two places — `FirmDatabase`'s constructor and `LiveTimerDurableObject.stopAndCommit`, the latter with a comment explaining precisely why the compare-and-set needs it. The other nine coordinators each have `setAlarm` and multi-step methods, and nothing tests what happens when a second call arrives while one is awaiting a service binding or a container. The alarm handlers are a second instance of the same question: an alarm firing concurrently with an RPC is two entries into one object.

**The browser side has one stale-response guard and no standard.** `apps/web/src/lib/magnus/conversation-session.svelte.ts` implements a `#generation` counter correctly — bump on every state change, capture before an await, compare after, discard if stale. It is the only one. Nine files use `AbortController`. Seven `.svelte` files carry an in-flight/submitting flag. Against 151 files using `$effect`, that is a surface with a known-good pattern applied in one place.

**Client idempotency keys are minted per call, not per user intent.** `writeKey()` in `apps/web/src/lib/costs/cost-operations.ts` is documented as "a fresh idempotency key for one write attempt and its retries," and every sibling API module has the same `crypto.randomUUID()` shape. That is right for a transport-level retry that reuses the key, and it is exactly wrong for a double-click or a user-initiated retry, which mint a new key and therefore get two effects. Whether that matters is per-surface, and nothing currently states which surfaces are protected by a disabled button and which are not.

**Nothing exercises concurrency above one request.** Every existing race test uses two operations. No test asks what a hundred concurrent draws against one counter do, and the load-profile harness measures throughput rather than correctness under contention.

**Rust:** no `loom`, no `shuttle`, no `proptest`, and `cargo test` does not run under ThreadSanitizer. The threaded surface is small and mostly read-only fan-out (`find_map_any` over candidates), which is genuinely low-risk, but "low-risk" is currently an assumption rather than a result.

## What the local substrate can and cannot prove

Worth being explicit, because a green test that structurally could not have failed is worse than no test.

**Faithful:** JavaScript-level interleaving. A `Promise.all` in a Vitest worker test interleaves at exactly the await points workerd interleaves at, because it is the same runtime. Two RPCs to one Durable Object in a pool test hit the real DO with the real input gate. Queue redelivery driven by calling the consumer twice is an honest model of at-least-once.

**Not faithful:** anything requiring two isolates or two colos. In production, two requests for one firm land on different isolates and possibly different continents; locally they are two promises in one isolate. Where the contended state is inside a DO this makes no difference (the DO is the serialization point either way, which is the architectural reason to put contended state there). Where it is anywhere else — R2, the control-plane database, a cache — the local test cannot reach the interleaving.

**Not faithful:** timing. `maxWorkers` is capped at 4 for the worker pool and file parallelism is off for `packages/conversion`; test scheduling is nothing like production scheduling. A race found by luck locally will not reproduce; this is the whole argument for deterministic interleaving over stress.

**Actively hostile:** running two suites at once. `CLAUDE.md` already states this — the single-flight lock is per-worktree, and a second concurrent run produces phantom failures in untouched files. Any stress testing must respect that, which is a further argument against stress as the primary technique.

## Techniques, ranked

**1. Generalize the interleaving harness. (High value, low cost.)** Promote `interleaveBeforeFirstCommit` out of `packages/matters/test/` into shared test support, generalized along two axes: fire before the _nth_ batch rather than only the first, and offer a read-side variant that fires after a named SELECT resolves. Every read-then-commit service then gets a three-line verifier that opens its real window deterministically. This is the single highest-return item, because the pattern is proven, the code exists, and the cost is a move plus a generalization.

**2. A guarded-write fitness function. (High value, medium cost.)** A `@repo-wide-fitness` source scan over composed `UPDATE`/`DELETE` statements that classifies each as guarded (extra predicate beyond the primary key), constraint-backed (a UNIQUE or CHECK in the same batch does the work), or bare — with an allow-list carrying a one-line reason per bare entry. The value is not the failures; it is that the 75 bare statements get triaged once and stay triaged, and a new bare write has to argue for itself in review. This is the same shape as the existing append-only and quarantine-status scans, so it fits the established idiom.

**3. Extend the two-caller DO test to every coordinator. (High value, low cost.)** The `firm-database-concurrency` and `live-timer-do` tests are templates. Each of the nine other coordinators gets: two concurrent calls to its state-transition method, and an alarm fired concurrently with an RPC. Where a method awaits a service binding or container mid-transition, the test should show what the second caller observes — and if the answer is bad, `blockConcurrencyWhile` is the fix the live timer already demonstrates.

**4. A stale-response standard for the browser. (Medium value, low cost.)** Extract the `#generation` pattern from the magnus conversation session into a small shared primitive, and pin it with component tests that resolve two loads out of order and assert the older one is discarded. Pair it with a survey of write surfaces for double-submit, deciding per surface whether the guard is a disabled control, a reused idempotency key, or both. A lint in the `tooling/lint-*` idiom could require that an async `$effect` writing component state either aborts or carries a generation check.

**5. Fault injection at the commit seam. (Medium value, low cost.)** `stubD1` already supports `failBatchWith` and scripted `meta.changes`. The under-used move is to script the _loser's_ view — force the UNIQUE conflict, force `changes: 0` — and assert the caller's recovery path rather than the winner's happy path. Most guarded writes today test that the guard is present in the SQL; fewer test what the code does when the guard actually bites.

**6. Property-based / linearizability checking. (High value, high cost — later.)** Generate random concurrent operation schedules against a real migrated database and check the result against a sequential model: for a counter, that N draws yield N distinct sequential values; for a ledger, that the balance equals the recomputed sum of lines under every interleaving. `fast-check` over the existing typed factories would fit the fixture discipline. Worth doing for the counters and the ledger specifically, not repo-wide.

**7. Stress and soak. (Low value locally, real value on the deployed site.)** High-concurrency hammering is the wrong tool locally — it cannot produce cross-isolate interleavings, it fights the single-flight lock, and a failure it does find is not reproducible. It is worth something against a deployed environment, where the isolates are real, as a periodic exercise rather than a gate. Note that `main` is production, so this needs a target that is not the firm's live data.

**8. Rust. (Low urgency, small scope.)** The threaded surface is three files. A `cargo test` job under ThreadSanitizer, or `loom` over the `find_map_any` cancellation path in `crates/decryption-core/src/recover.rs`, would convert the current assumption into a result at modest cost. Low urgency because the surface is read-mostly fan-out, not shared mutation.

## The one thing to take away

The architecture is unusually well set up for this: contended state is behind a Durable Object that serializes, every mutation goes through one batch chokepoint, at-least-once delivery is stated rather than assumed, and the sharpest invariants are enforced by database constraints rather than by application code that cannot be atomic. That means most races here are not lurking in clever code — they are in the specific, enumerable set of write paths that read their precondition in one round trip and commit in another without carrying a guard into the batch.

That set is finite, it is machine-detectable, and a deterministic harness for it already exists in one package. Items 1 through 3 above are the ones that convert this from a review angle into a standing gate.

## Follow-ups if this is adopted

- An ADR recording the technique choice, and an edit to [`docs/conventions/testing.md`](../conventions/testing.md) instantiating angle 2 with the named harness, the way the ledger and load-profile slices instantiate their own angles.
- The shared harness's own home and a test proving it can still see a commit (the same non-vacuity argument the background-work barrier's test makes).
- A decision on where stress testing runs, given that `main` is production.
