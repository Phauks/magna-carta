---
category: Fixed
audience: internal
---

**The pre-push hook took its migration-integrity check through the test runner, so an unrelated suite
running in another worktree could fail the push — under the words "migration integrity", which reads
as lineage corruption.** It failed that way twice in one session while another agent was building
elsewhere; both times the same check passed standalone in about 600 ms, and both times the printed
label sent the reader looking for a broken journal. The second lesson taken from it was `--no-verify`,
which is the expensive part: a hook that cries corruption over contention does not just waste a
diagnosis, it teaches people to switch the hook off.

The checks never needed a runner. They are structural assertions over the committed journal, the
`.sql` files and the `meta/` snapshots, plus one apply of the whole chain into an in-memory
`node:sqlite` — no Miniflare, no browser, no worker pool, no fixtures. They now live at
`tooling/migration-integrity/` as a plain script, and the three callers all drive that one module:
the pre-push hook and the gate's `governance` job run `node tooling/migration-integrity/index.mts`
directly, and a Vitest twin runs the same functions with the normal suite. `packages/database/test/migration-integrity.test.ts`
is gone — its content moved wholesale rather than being copied, so the hook and the suite cannot
drift into disagreeing about what a sound lineage is.

Two things were tightened while the checks moved. A lineage that loads zero migrations now fails
instead of passing: every rule above it is satisfied vacuously by an empty set, and a guard that
clears nothing is indistinguishable from a guard that ran. And any error raised while taking the
checks — an unreadable journal, an absent `drizzle/` directory — is reported as a failure rather than
allowed to look like a clean run.

**The gate's `lint:test-collection` was also reported as counting seven files more than the gate
collects. It does not, and the seven have a name.** Measured on a quiet machine at 949 registered
test files: the lint asserts 656 for `test-node`, an unfiltered run executes `Test Files 656 passed
(656)`, and the two CI shards execute 328 and 328 with no file in both and no file in neither.
`test-worker` reconciles the same way at 238.

The reported 649 came from an invocation carrying **ten** of `test-node`'s **fourteen** positional
paths. The four missing ones — `apps/{recovery,scan,search,sign}-worker` — hold exactly 7 files and
41 tests, which is the whole of the reported gap in both figures (656 − 7 = 649, 7475 − 41 = 7434).
Nothing runs nowhere. The path list wraps over five YAML lines and gets copied short, and a short
list does not fail: it runs a subset and reports green, which is the same property that made the
original mis-scoped filter invisible. `pnpm run lint:test-collection --print-invocations` now emits
each job's command resolved onto one line so a count can be reproduced without retyping anything.

What the episode did expose is that the lint had no way to be checked. It existed to prove something
about the gate, and its own set arithmetic — floor, union, disjointness, drift — had never been run
against a known-bad input, which is the same posture as the workflow comment that confidently claimed
a mis-scoped path "fails loud" and was false for months. So the lint moved to
`tooling/lint-test-collection/`: the arithmetic is now separable and covered by
`collection.test.mjs`, where each assertion is shown to bite on the failure it names and to stay
quiet on the near-miss that is legitimately fine (a file claimed by two projects is two entries, not
a double-payment). One real hole is closed with it — the lint checked that every invocation it holds
still exists in the workflow, but never the reverse, so a fourth test job added to `gate.yml` and
never registered would have taken a share of the suite that the coverage check then credited to
nobody. The invocation list is now closed in both directions.

`docs/conventions/build-performance.md` records what the lint proves and, newly, where that proof
stops: at collection, not execution, with the measurement that currently bridges the two and the
warning not to read a shard's count as a job's.
