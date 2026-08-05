---
category: Fixed
---

**The per-firm migration generator diffs against the real schema head again.** The drizzle snapshot in
`packages/database/drizzle/per-firm/meta/` had fallen eight migrations behind the journal, so
`generate-per-firm-migrations` compared the schema against a state that predated the document-automation
and custodian tables and re-emitted all of them — a migration that would have failed on every
already-provisioned firm, and the reason recent migrations were written by hand. The snapshot is now
re-derived from `per-firm-schema.ts` at the lineage head: generating against an unchanged schema emits
nothing, and a one-column change emits only that column. The control-plane lineage was audited the same
way and was already current. `refresh-snapshot.mjs` and its package scripts
(`refresh-per-firm-snapshot`, `refresh-control-plane-snapshot`, `check-snapshots`) make the repair a
single step next time a hand-written migration outruns the snapshot, and the new
`packages/database/CLAUDE.md` documents when to run it.
