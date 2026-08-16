---
category: Added
audience: internal
---

**`pnpm check:scoped` now runs the repo-wide set — the checks a diff-scoped gate structurally cannot
find.** A repo-wide check does not live in the package whose code it governs, so the diff that breaks it
is routinely in a package that has never heard of it; three changes reached `main` red in one session that
way, while the whole-repo tier that would have caught all three was unavailable (Actions billing block,
and `pnpm check` OOM-killed at step one). Two new steps: `repo-wide lints` always (~0.7 s — twelve
whole-repo scans spawned concurrently as the commands their scripts name, rather than through twelve
`pnpm run` startups), and `repo-wide fitness sweep` whenever the diff touches first-party source (~2.5 s —
nine Vitest scans in one process under `tooling/check-scoped/vitest.repo-wide-fitness.config.ts`, which
costs 2.5 s against the root workspace's 8.5 s for the same files, plus a `schema` scope of ten more when
`packages/database` moves).

Membership is **derived, not listed** — a roster of repo-wide checks is the same drift one level up. The
lints are enumerated from the `lint:*` scripts in the root `package.json` (the CI `governance` job now
calls the same runner with `--all`, so the tiers cannot disagree); the fitness tests self-register with an
`@repo-wide-fitness` directive in their own header. Two lints are deferred with their numbers:
`lint:licenses` (1.6 s, dependency-set-only — runs when a manifest or lockfile changes) and
`lint:test-collection` (26 s — CI's own job). `apps/worker`'s route conformance is excluded outright at
26 s in the Miniflare pool.

Measured warm, before → after: a markdown-only diff 0.9 s → 1.6 s, one ordinary source file 2.3 s →
4.9 s, a `packages/database` schema file 4.7 s → 7.8 s. `lint:test-registration` learned about
**re-runner** configs (a Vitest config that owns no tests, only re-runs files belonging to other
projects) and refuses to let one be registered twice. Homes:
[`tooling/check-scoped/repo-wide.mjs`](../tooling/check-scoped/repo-wide.mjs),
[`docs/conventions/build-performance.md`](../docs/conventions/build-performance.md),
[`docs/conventions/testing.md`](../docs/conventions/testing.md).
