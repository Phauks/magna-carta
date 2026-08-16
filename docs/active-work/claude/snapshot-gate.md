---
worktree: /home/user/magna-carta/.claude/worktrees/snapshot-gate
area: wire the drizzle snapshot-freshness check into the quality gates
status: review
touches: tooling/check-scoped/index.mjs, package.json, .github/workflows/gate.yml, packages/database/scripts/refresh-snapshot.mjs, packages/database/CLAUDE.md, docs/conventions/build-performance.md
---

The per-firm drizzle snapshot has fallen behind the schema twice, weeks apart, because
`check-snapshots` existed and no gate ran it. This stream adds it to `pnpm check:scoped` (conditional
on a `packages/database/` change), to the whole-repo `pnpm check` (unconditional, so it is real while
the CI account is billing-blocked), and to the CI `governance` job beside the migration-integrity
test. The checker itself is unchanged apart from its failure message, which now names the repair
command. No schema, migration, or snapshot content is touched — a concurrent stream editing
`packages/database/src/*-schema.ts` will not conflict with this one, though it will start seeing the
new gate step.
