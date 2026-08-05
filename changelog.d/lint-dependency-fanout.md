---
category: Changed
---

**The gate's type-aware lint now scopes by measured cost instead of by graph distance, cutting the
single most expensive job out of the pull-request tier.** On a measured pull-request gate run
(2026-08-05, 17 jobs) the `lint` job billed **26 minutes of roughly 60 for the whole run — 43% of the
bill** — and it did so at the _cheap_ scoped tier, because the scope was correct and it contained
`apps/worker`.

The cause is the dependency shape. The type-aware linter builds its type program from the passed
files' import closure, so a package's lint cost tracks the size of that program; `apps/worker`'s is
**1,261 of the repository's 1,669 lintable files (75.6%)**, and the worker depends _directly_ on 39 of
the 61 workspace packages, so almost any foundational change pulled it in. The old lever — capping the
pull-request tier's dependent walk at one hop — could not help, because the expensive package sits one
hop from nearly everything.

`tooling/affected-lint` now measures that cost directly. A package is a **fan-out sink** when its
type-program weight is at least half the workspace's lintable files; on a pull request the classifier
drops the sinks from the scope **when they are in scope only as a dependent**, and every other trigger
lints them. A sink the change itself touched is never deferred, so an author's own code is always
linted on their own pull request. Every trigger now walks the full transitive dependent closure, so the
pull-request tier also gained coverage everywhere linting is cheap: a change to `@magna-carta/trust`
used to lint 2 packages one hop out, and now lints its whole closure.

Because a scope that is too narrow reports a fast green rather than a failure, the union is proved
rather than reviewed. A new `pnpm run lint:affected-scope`
(`tooling/affected-lint/scope-fitness.mjs`, wired into the gate's `governance` job) simulates a change
to **every** workspace package and fails if the changed package is not linted on its own pull request,
if the pull-request and post-merge scopes together miss any package in the true dependent closure, or
if anything but a declared sink is dropped. It derives that closure by an independent fixpoint over the
same package graph the classifier reads, and it also fails if the sink rule ever stops selecting an
outlier — no sink at all, more than two, or one weighing under 1.5x the heaviest non-sink — which is
the signal to delete the deferral rather than widen it.

Measured on a 4-core/15 GB box for a change to `@magna-carta/identifiers`: the new 28-package
pull-request scope lints 883 files in **9 seconds**, where `apps/worker` alone lints 394 files in
**2,755 seconds**. The cost model, the timings, and the two refinements measured and rejected on the
way — file-granular scoping and content-hash caching — are in `docs/conventions/build-performance.md`.
