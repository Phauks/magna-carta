---
worktree: C:/dev/magna-carta-worktrees/claude/zen-franklin-qwi2fk
area: Migration system — generated worker bundles, a merge-journal resolver, and an immutability gate for deployed tags
status: building
touches: tooling/migration-bundles, tooling/migration-integrity, tooling/merge-journal, apps/api-worker/src/*-migrations.ts, packages/database, package.json, vite.config.ts, docs/conventions/, changelog.d/, docs/decisions/pending/
---

Hardening the migration system after a tag/idx inversion reached `main`. Three pieces, all in
`tooling/`: the worker's tag-to-SQL bundle modules are now GENERATED from the journal rather than
kept by hand; a resolver turns a conflicted `_journal.json` into a correctly ordered one and
re-stamps the incoming migration above the new head; and a gate refuses to change or remove a tag
that is already on `main`, which is already deployed.

A concurrent stream that ADDS a migration should expect `apps/api-worker/src/per-firm-migrations.ts`
and `control-plane-migrations.ts` to stop being hand-edited — run `pnpm run migration-bundles` and
commit what it writes. Nothing else here touches application code.
