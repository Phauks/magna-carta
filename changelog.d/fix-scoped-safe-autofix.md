---
category: Fixed
---

**`pnpm fix:scoped` no longer applies the two autofixes that are wrong in this repo, and `pnpm test`
refuses a second concurrent run instead of wedging.** Two inner-loop hazards, both recurring.

The fixer applied every lint autofix the linter offered. Two of those rewrites are not safe here:
`unicorn/no-array-sort` turns `.sort()` into `.toSorted()`, which is ES2023 and fails to compile in
packages built against `lib: ES2022` (`TS2550`, plus `TS7006` on the callback parameters — hit
repeatedly in `@magna-carta/fixtures`); and `typescript/no-unnecessary-boolean-literal-compare`
rewrites the deliberate `meta.authenticated === false` in the worker's access-control route metadata
to `!meta.authenticated`, changing what a reviewer of a security guard reads. Both are now excluded
from the fix pass and listed with their reasons in `tooling/check-scoped/unsafe-autofix-rules.mjs`,
which the fixer prints at the end of every run. The exclusion is fix-pass only: the lint ruleset in
`vite.config.ts` is untouched, so `pnpm check:scoped`, `pnpm check` and the editor still report both.
Mechanically the fixer now drives the formatter through `vp check --fix --no-lint` and the lint
autofix through `vp lint --fix -A <rule>`, because `vp check` rejects the linter's `--allow` flag.

Separately, two test runs started in one worktree contend for the same transform cache, Miniflare
state and worker pool, and wedge each other at 0% CPU — a hang that reads as slowness. `pnpm test` is
now the guarded entry point (`tooling/test-single-flight/`): the same `vp test` with every argument
passed through, behind a per-worktree single-flight lock that refuses a second run in milliseconds and
names the run already in flight. The lock is reclaimed when its holder is gone or after 90 minutes, so
a killed run cannot leave a worktree unable to test; `MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1` overrides
it. CI is unaffected — its shards each own their own container.
