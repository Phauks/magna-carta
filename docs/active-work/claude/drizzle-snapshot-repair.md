---
branch: claude/drizzle-snapshot-repair
worktree: C:/dev/magna-carta-worktrees/claude-drizzle-snapshot-repair
area: Bring the drizzle per-firm snapshot back to the lineage head so the migration generator diffs correctly
status: review
touches: packages/database/drizzle/per-firm/meta/, packages/database/scripts/, packages/database/package.json, packages/database/CLAUDE.md, changelog.d/
---

The per-firm `meta/` snapshot stood at idx 14 (`20260804T072255_matter-number-allocation`) while the
journal head was idx 22 (`20260804T170001_custody-review-schedule`), so `generate-per-firm-migrations`
diffed the schema against an eight-migration-old state and re-emitted the document-automation and
custodian tables in full — which is why the last few migrations were hand-written. This stream
re-derives the snapshot from `src/per-firm-schema.ts` and commits it as
`meta/0022_snapshot.json`. The control-plane lineage was audited the same way and was already at head,
so it is untouched.

**No schema change and no new migration** — snapshots, one new script, and docs only. The only
executable addition is `packages/database/scripts/refresh-snapshot.mjs` (plus its three package
scripts), which makes the repair a one-step operation the next time a hand-written migration outruns
the snapshot; the procedure is documented in the new `packages/database/CLAUDE.md`.

Concurrent streams that add a per-firm migration will conflict on nothing here except
`meta/_journal.json`, which this stream does not touch. A stream that _generates_ a migration after
this lands will produce a snapshot at its own idx and a much smaller `.sql` than before — that is the
intended effect, not a conflict.
