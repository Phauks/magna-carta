---
worktree: C:/dev/magna-carta-worktrees/claude/gracious-turing-3pqa6i
area: Runtime reconciliation for a re-stamped migration tag — unbrick a firm database that applied a tag the 2026-09-15 rename retired
status: building
touches: packages/database/src, packages/database/test, packages/database/CLAUDE.md, tooling/migration-immutability, docs/deploy-queue.md, changelog.d, docs/decisions/pending
---

The 2026-09-15 re-stamp of `20260911T000000_office-email-address-lines-and-firm-brand-images` and
`20260914T090000_event-conference-link` was taken on the premise that no database had applied either
id. A production firm database had, and it now refuses to wake. This stream adds the re-stamp
registry the runner consults before it refuses, so the ledger is rewritten in place rather than the
database being recreated.

Owns `packages/database/src/re-stamped-migrations.ts` (new), `migration-runner.ts`, and
`tooling/migration-immutability/index.mts`. Anything else touching the migration runner or the
immutability gate should wait on this.
