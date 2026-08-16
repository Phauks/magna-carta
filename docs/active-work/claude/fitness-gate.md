---
worktree: /home/user/magna-carta/.claude/worktrees/fitness-gate
area: Repo-wide fitness functions run in the inner loop, not only in a CI tier that is not running
status: building
touches: tooling/check-scoped/, tooling/lint-test-registration.mjs, package.json, .github/workflows/gate.yml, docs/conventions/build-performance.md, docs/conventions/testing.md, changelog.d/, docs/decisions/pending/, and a one-line directive comment at the top of ~19 existing fitness test files
---

`main` went red three times in one session, each on a different check, each missed the same way: a
**repo-wide fitness function does not live in the package whose code it governs**, so the diff-scoped
gate never ran it. The whole-repo tier that would have caught all three — `pnpm check` and the CI
gate — is the tier that is not running (GitHub Actions has started no job since 2026-08-05).

This stream closes the class rather than the three instances. `pnpm check:scoped` gains two
clearly-labelled steps: the derived repo-wide lint set (always), and a repo-wide fitness vitest sweep
under its own config (when the diff touches first-party source).

**Membership is derived, not listed.** The lints are enumerated from `lint:*` in the root
`package.json` minus a small documented deferral map; the fitness tests self-register with an
`@repo-wide-fitness` directive comment in their own header. Nothing in `tooling/check-scoped/`
carries a hand-maintained roster, because that roster is this same bug one level up.

Nothing here touches product code, UI, or deploy. The only edits outside `tooling/` and docs are the
one-line directive comment added to each member test file, and one repair to a `changelog.d/`
fragment that is failing `lint:changelog-fragments` on `main` today (the new always-on step would
otherwise turn every inner loop red on arrival).
