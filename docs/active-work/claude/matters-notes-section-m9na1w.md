---
worktree: C:/dev/magna-carta-worktrees/claude/matters-notes-section-m9na1w
area: The matter note primitive — stage 1 of the notes-and-activity design
status: building
touches: packages/notes, packages/identifiers, packages/access-control, packages/database, packages/calendar, packages/data-access, packages/merge-field-catalog-contract, apps/api-worker, apps/web, status.d, changelog.d, roadmap.d, docs/user
---

Builds stage 1 of `docs/specs/2026-08-15-notes-and-tasks-implementation-plan.md`: the matter note as a
chain of revisions, retractable and never deleted, joined to the federated timeline as one declared
source. New package `@magna-carta/notes`, two per-firm tables with append-only triggers on the
revision table, three permissions, the matter Notes section made real.

Owner flags answered on 2026-08-31: W1 build it, W2 matter notes first, W4 triggers on revisions,
W5 notes stay outside the discovery collection vocabulary, W6 bodies indexed with no snippet.

Concurrent streams should not step on: `packages/calendar/src/sources/all.ts` (one new source entry),
`packages/identifiers/src/registry.ts`, `packages/access-control/src/registry.ts`,
`packages/data-access/src/pii-registry.ts`, `apps/web/src/lib/matters/sections.ts`.
