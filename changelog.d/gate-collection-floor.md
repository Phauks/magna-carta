---
category: Fixed
---

**The whole-repo gate was running 40% of the test suite while reporting green.** Its `test-node` job
passed the relative paths `packages` and `tooling` to the test runner as positional filters. Those two
directories are the _parents_ of project roots, not project roots, and the runner matches a positional
filter per project against the candidate file's path relative to **that project's own root** — under
`packages/ledger` a test file is `test/posting.test.ts`, in which neither `packages` nor its reduction
`..` appears. So every package and every tooling suite dropped out of collection, the job ran the files
it did match, and exited 0. Measured on the tree before the fix: `test-node` collected **41** of the
**476** files it is named for; across the three test jobs, **435 of 719 registered test files ran
nowhere** — every `packages/*` suite, every `tooling/*` suite, and `apps/sign-worker`, which had also
never been added to the job's path list.

The gate's test jobs now filter with absolute paths (`"$PWD/packages"`), which take the runner's other
branch — a prefix test against the file's absolute path — and narrow the way the spelling implies.
`apps/sign-worker` is in the list. The three jobs collect 476 + 192 + 51 = **719** files: the whole
registry, exactly once each.

Because a filter that matches nothing is indistinguishable from a fast suite, the coverage is now
asserted rather than reviewed. A new `test-collection` gate job runs `pnpm run lint:test-collection`
(`tooling/lint-test-collection.mjs`), which re-runs each of the gate's own test invocations in
list-only mode — no test executes — and fails if the unfiltered whole-suite collection falls below a
committed floor, if the union of the jobs is not the whole suite, or if two jobs collect the same file.
It holds each invocation verbatim and checks it against `.github/workflows/gate.yml`, so editing the
workflow without the lint fails loudly instead of drifting. The floor is a generous minimum (90% of the
current count) with its update procedure recorded beside it.

The mechanism, the absolute-path rule, and a second trap found alongside it — negated `--project`
patterns are OR-ed, so two of them cancel and select everything — are written up in
`docs/conventions/build-performance.md`.
