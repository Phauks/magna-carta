---
worktree: /home/user/magna-carta/.claude/worktrees/gate-integrity
area: Verification machinery — the pre-push hook's migration-integrity step and the gate's test-collection lint
status: building
touches: tooling/migration-integrity/, tooling/lint-test-collection/, tooling/git-hooks/pre-push, .github/workflows/gate.yml, vite.config.ts, package.json, packages/database/CLAUDE.md, packages/database/test/migration-integrity.test.ts, docs/conventions/build-performance.md, status.d/, changelog.d/
---

Two defects in the machinery that answers "does the gate run what it claims to run".

The pre-push hook took its migration-integrity step through the test runner, which stands up a worker
pool and a transform cache on a machine that may already have a suite running in another worktree —
and prints any resulting failure under the words "migration integrity", which reads as lineage
corruption. The checks are structural assertions over the committed journal, `.sql` files and
snapshots plus one in-memory `node:sqlite` apply, so they are now a plain script at
`tooling/migration-integrity/`, driven by the hook, by the gate's `governance` job, and by a Vitest
twin — one implementation, no runner, no pool.

The `lint:test-collection` counts were reported as disagreeing with what the gate collects; they do
not (measured: 949 registered, 656 for test-node, 656 executed, 328 + 328 across shards). What the
lint genuinely lacked was any test of its own reasoning and any guard against a test job added to the
workflow but never registered in it. Both are now closed, and the lint moved to
`tooling/lint-test-collection/`.

Concurrent streams: this owns `tooling/` and `.github/workflows/gate.yml`. It touches three files
outside that — a one-line project registration in `vite.config.ts`, the `lint:test-collection` script
path in `package.json`, and the pointer in `packages/database/CLAUDE.md` — plus the deletion of
`packages/database/test/migration-integrity.test.ts`, whose content moved wholesale into
`tooling/migration-integrity/`. Nothing under `packages/database/src/` or `drizzle/` is touched.
