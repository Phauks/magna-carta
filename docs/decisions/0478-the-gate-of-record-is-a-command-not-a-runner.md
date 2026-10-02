---
number: 478
slug: the-gate-of-record-is-a-command-not-a-runner
status: Accepted
date: 2026-09-16
area: Dev tooling
summary: "The whole-repo quality gate moves off GitHub Actions and into one local command, `pnpm gate` (tooling/gate/), run on the machine that made the change before it merges; the gate.yml workflow, its seed-caches.yml companion and the required `gate` status are removed. Same dimensions, same commands, same path classification; the type-aware lint covers the full dependent closure with no sink deferral, the test battery runs whole on every code change rather than on a label, and the dependency audit downloads the pinned osv-scanner by version and hash. Supersedes ADR-0184 on where the gate runs; the pre-push hook stays the fast diff-scoped subset."
---

**The gate of record is a command, not a runner.**

**Context.** From 2026-07-13 the whole-repo gate ran as a GitHub Actions workflow, required on every
pull request into `main` through its aggregate `gate` status. It was a good workflow — a fan-out over
a dozen runners, path-filtered, cached, with the test battery split along the suite's substrates — and
it ran on a budget the repository did not control. The account's Actions minutes ran out on
2026-08-05, and again on 2026-09-03 after a month of running; each time the required status stopped
reporting, every pull request wedged behind a check that had not run, and every merge went through on
an administrator override. Two austerity postures, a revert checklist keyed on `runner_id`, and a
recognition rule for a job that never started were all written to manage a gate that was, for most of
the period since it was built, not running. Since 2026-08-29 a merge to `main` is a production deploy,
so the verification that ran before each of those merges was whatever the branch ran by hand.

**Decision.** The gate is `pnpm gate` (`tooling/gate/index.mjs`), and nothing in the repository's
verification depends on a hosted runner.

- **The same checks, the same shape.** One classification of the change (the workflow's own: docs and
  the rendered trackers are non-code, a source extension counts wherever it lives), then the
  dimensions in order — format, governance, audit, wasm, typecheck, contracts, lint, rust, containers,
  test-collection, tests — each run only when the change can reach it, and each saying so when it does
  not. A failed dimension does not stop the rest; the summary is the deliverable and the pull-request
  template asks for it in place of the `run-tests` label.
- **Nothing deferred.** The type-aware lint covers the changed packages and their full transitive
  dependent closure, fan-out sinks included; the workflow deferred the sinks on a pull request to save
  minutes and linted them post-merge, and there is no bill and no post-merge pass here. The test
  battery runs whole, under the single-flight lock, on every code change. The flag and the substrate
  arguments stay in `tooling/affected-lint` for whoever wants the cheaper pass, and `lint:affected-scope`
  still proves it sound.
- **The audit travels.** The dependency audit downloads osv-scanner by pinned version and per-platform
  SHA256 into `node_modules/.cache` when it is not on PATH, verifies it before running it, and audits
  every first-party lockfile derived from disk. A scanner that cannot be fetched is reported `NOT RUN`
  rather than passed, and the gate still exits 0 so an offline machine is not blocked on a network it
  does not have.
- **Removed.** `gate.yml`, `seed-caches.yml` (it existed to warm the workflow's cache), `lint:cache-keys`
  (it held the two workflows' cache keys identical), and the gate dispatch in `assemble-docs.yml`.
  `lint:test-collection` keeps its collection floor and drops the partition proof only a sharded split
  needed. `lint:lints` reads the fitness-sweep step off the gate's step list. The pre-push hook is
  unchanged in substance: the fast diff-scoped subset, with `pnpm gate` named as what runs before a
  merge.
- **One owner step.** The `main` ruleset must stop requiring the `gate` status; the repository cannot
  change that, and until it changes GitHub waits for a check nothing will report. Recorded on the
  deploy queue.

**Considered and rejected.** _Keeping the workflow and telling every session to bypass it_ — which is
what had been happening — makes the override the routine and the gate the exception, and it trains
everyone that a red check means nothing. _Moving the workflow to another CI provider_ — evaluated on
2026-08-05 and not pursued then; it trades one budget for another and the repository already pays
Cloudflare for Workers Builds, which builds and deploys but runs no checks. _Restoring the workflow when
the minutes reset_ — the minutes reset once and the block recurred within three days; a gate that is
present one month in three is a gate people learn to work around. _A local gate that keeps the sink
deferral_ — cheaper, but it would need a second pass somebody remembers to run, which is the shape
that just failed.

**Consequences.** A pull request's verification is what its author ran, stated in its description; no
status on GitHub reports it, and a merge to `main` is a deploy, so a pull request with no gate summary
is a pull request whose verification is unknown. The wall-clock is the sum of the dimensions rather
than the tallest, which the classification keeps proportionate: a docs change runs in about a minute,
a few-package change lints in seconds, and a change that reaches the app worker pays that lint on the
branch. The nightly sweep is `pnpm gate --all` after a batch of merges. `assemble-docs.yml` is the one
workflow left and still needs minutes; while the budget is out the fragments wait for the weekly
docs-sync routine or a session, and nothing else waits on it. Supersedes ADR-0184 on where the gate
runs; ADR-0144's pre-push posture stays superseded — the hook is still the fast subset, not the gate.
