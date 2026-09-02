---
worktree: C:/dev/magna-carta-worktrees/claude/matters-notes-section-m9na1w
area: The matter note primitive — stage 1 of the notes-and-activity design
status: building
touches: packages/notes, packages/identifiers, packages/access-control, packages/database, packages/calendar, packages/data-access, packages/design-system, packages/merge-field-catalog-contract, apps/api-worker, apps/web, status.d, changelog.d, roadmap.d, docs/conventions, docs/user
---

Builds stage 1 of `docs/specs/2026-08-15-notes-and-tasks-implementation-plan.md`: the matter note as
one row, edited in place and deleted outright, carrying the occurrence of the thing it describes and
the matter's files it points at, joined to the federated timeline as one declared source. Package
`@magna-carta/notes`, two per-firm tables, two permissions, the matter Notes section made real.

Owner flags answered on 2026-08-31: W1 build it, W2 matter notes first, W5 notes stay outside the
discovery collection vocabulary, W6 bodies indexed with no snippet. W4 (triggers on revisions) was
answered and then reversed on 2026-09-01 together with the whole revision model — an edit overwrites
and a delete removes the row.

Owner review round on 2026-09-01 (recorded in `docs/conventions/design-corrections.md`): the note
opens in the shared record window rather than an inline composer, the primary action reads
"+ New Note", the occurrence field is labelled Date with Time on the same line, and a document is
attachable while the note is still a draft. The reported symptom that opened the round — the section
never leaving its skeleton — did not reproduce against a real Worker; the read was rebuilt as an
effect of its own regardless, so nothing else the screen wants can abort it.

On 2026-09-02 the stream also built the matter's **Activity** section over the federated timeline
(`GET /api/v1/matters/{matterId}/timeline`), which had been served with no web caller. The screen is
driven by a presentation registry paired to the calendar package's source declarations by a scanning
test, so a subsystem joining the timeline reaches the screen with one entry and no other work.

Concurrent streams should not step on: `packages/calendar/src/sources/all.ts` (one new source entry,
and three deep-link section slugs repaired), `packages/identifiers/src/registry.ts`,
`packages/access-control/src/registry.ts`, `packages/data-access/src/pii-registry.ts`,
`apps/web/src/lib/matters/sections.ts` (one new section), and
`packages/design-system/src/lib/components/record-attachments/record-attachments.svelte` (the upload
source is now rendered only for a record kind that passes `onAttachUpload`).
