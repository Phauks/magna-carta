---
branch: claude/one-core-runners
worktree: .claude/worktrees/agent-a58341afdc2bc4fba
area: Move the gate's short jobs to GitHub's 1-vCPU Linux runner
status: review
touches: .github/workflows/gate.yml, changelog.d/
---

GitHub's `ubuntu-slim` runner is 1 vCPU / 5 GB at **$0.002 a minute** against the 2-core
`ubuntu-latest`'s **$0.006** — a third of the rate for the same work. This stream moves the gate jobs
that are short and not meaningfully parallel onto it and leaves everything else where it is. Nothing
about what the gate checks changes; the diff is `runs-on:` lines and the comments that justify them.

**Moved** (measured job wall-clock from a real pull-request run, plus a local single-core re-run):
`changes` (8 s), `format` (76 s; 62 s pinned to one core against 34 s on four), `governance` (40 s;
the lints plus the migration test ran in 10 s on one core), `contracts` (54 s; all four checks in 21 s
on one core, each peaking around 200 MB), `test-node` x2 (52 s / 47 s; shard 1 of 2 in 19 s on one
core), and the `gate` roll-up (3 s).

**Left on `ubuntu-latest`**, each for a stated reason: `lint` (26 min measured, and `GOMEMLIMIT` is
10 GiB against 5 GB), `typecheck` (cold `tsc -b` plus two svelte-check passes, multi-gigabyte and
core-hungry), `test-worker` (246-267 s per shard, a Workers runtime per file, too close to the cap),
`test-stories` (Chromium with `--with-deps`), `rust` (cargo wants cores), `containers`
(multi-gigabyte image builds, 90-minute cap), and `wasm` — which on a cache miss runs `docker build`,
and the slim runner is an unprivileged container carrying the Docker CLI but **no daemon**.

Three `ubuntu-slim` properties are hard and worth knowing before moving any other job onto it: a
platform-enforced **15-minute job cap** that overrides any longer `timeout-minutes`, **5 GB** of
memory, and **no Docker daemon, no Docker container actions, no service containers**.

## Files expected to be touched

- `.github/workflows/gate.yml` — `runs-on:` lines and per-job comments only. The austerity markers
  dated 2026-08-05 are read and left exactly as they are; this stream suspends nothing and restores
  nothing.
- `changelog.d/one-core-gate-runners.md`.

**Not edited:** `docs/conventions/build-performance.md` (claimed by other streams) — the runner-choice
policy currently lives in the workflow's own header comment, and folding it into that convention is a
follow-up for whoever next owns the file.
