---
category: Fixed
audience: internal
---

**Three stale truths in the tooling and the area guides: `pnpm test | head` wedged holding the lock,
sixteen places claimed the node-sqlite adapter has no `.first()` when it has had one since June, and
the gate justified its coverage check with a premise that measures the opposite of what it says.**

**A closed output pipe no longer wedges the test guard.** `head` exits as soon as it has its lines.
Node ignores `SIGPIPE` and turns the failed write into an asynchronous `EPIPE` on the stream, so a
reporter that swallows that error neither finishes nor makes progress — the run sits at 0% CPU **still
holding the per-worktree single-flight lock**, which is precisely what the contention the lock exists to
prevent looks like, so the diagnosis goes to the lock instead of to the pipe. Reproduced against a
runner stand-in that swallows `EPIPE`: still alive at 30 s, `STAT Sl`, lock held by a **live** pid, and
cleared only by hand. That last detail is why recording the holder's pid cannot fix this and no lock
change was made — pid reclaim already exists and works, but the holder here is blocked rather than
dead, so a liveness probe correctly reports it alive and correctly refuses the next run. Only ending the
run frees the lock. `tooling/test-single-flight/broken-pipe.mjs` now tears the run down on a broken
pipe, releases the lock, and exits 141; the same case now finishes in 1 s with the lock released and the
child reaped. Because a parent using `stdio: "inherit"` cannot observe the child's failed writes at all,
output is forwarded through the parent whenever stdout is not a TTY — verified to produce byte-identical
output to the old path — while a TTY, where no reader can walk away, keeps `inherit` unchanged.

**The `.all()` + `results[0]` rule keeps its conclusion and loses its false reason.** Three area guides
and thirteen source comments said the node-sqlite test adapter has no `.first()`. It has had one since
`first<T>()` was added to every adapter "to match the D1 surface" in June, and two data-access tests
exercise it against that adapter today, including the returns-`null` case. A real reason to prefer
`.all()` does exist and the rule is now stated on it: uniformity of the absent-row sentinel. `results[0]`
is `undefined`, `first()` is `null`, and the several hundred existing read sites all compose the
`undefined` form — so a second spelling buys nothing and makes every reader check which one applies. The
reasoning now lives once, on the interface declaration in
`packages/data-access/src/idempotency-statements.ts`, and the sixteen copies point at it instead of
repeating a claim that would send someone to "fix" a working adapter.

**The gate's coverage check is justified by the case that actually happens.** A comment in
`gate.yml` held that a filter matching no file "exits 0 having run nothing". It exits **1**, printing
`No test files found, exiting with code 1` — measured across `run`, `--shard=i/N` and `--project`. The
`test-collection` job is still well justified, but by **silent narrowing**: these jobs pass a dozen-odd
paths each, so one wrong entry among good ones still collects the rest and exits **0** over a fraction
of the suite. Measured: one relative path beside a good one collected 34 files and reported a green
`Test Files 34 passed (34)` against the 656 that job owns, and nothing in the output distinguished the
two. A false premise in front of a correct conclusion invites the next reader to delete the conclusion,
so the sentence was corrected rather than removed — in `gate.yml`, in
`tooling/lint-test-collection/index.mjs`, in the analogy that rests on it in
`tooling/affected-lint/scope-fitness.mjs`, and in `docs/conventions/build-performance.md`, which is the
cited home for the mechanism and carried the same claim.
