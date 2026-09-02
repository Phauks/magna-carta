---
worktree: C:/dev/magna-carta-worktrees/claude/matter-consolidated-search-yba72d
area: consolidated search within a matter — the source registry, the one route, the control in the matter header; and the conflicts read surface, at design stage
status: review
touches: packages/matter-search, packages/access-control, packages/database, apps/api-worker, apps/web/src/lib/matters, apps/web/src/lib/api/request.ts, packages/design-system/src/lib/components/screen-search, tooling/lint-matter-search-coverage, docs/conventions/design-corrections.md, docs/specs, docs/user/features, roadmap.d/core-domain.md, status.d
---

# matter-consolidated-search

The matter's own search: one control in the matter header, a scope that opens on the section the
reader is standing on and widens to the whole matter, and a registry of declared sources so a new
searchable section is one source module rather than a change to the control, the route and the
results page.

**Slice 1 is built and green.** `@magna-carta/matter-search` (registry, shared statement builder,
four sources), `GET /api/v1/matters/{matterId}/search` with its two permission gates, the
`search:matter` key and its seed migration, the control in the matter layout, the results page, and
`lint:matter-search-coverage`. 65 package tests, 12 route tests, 12 web tests; svelte-check clean;
conformance green.

**Files this stream owns, and would collide on:**

- `packages/matter-search/**` — new, entirely this stream's.
- `apps/web/src/lib/matters/matter-search*` and `sections.ts` — the section registry gained a
  required `searchSource` field, so any stream adding a matter section touches the same file.
- `apps/web/src/lib/matters/matter-header.svelte` — the control renders here.
- `packages/access-control/src/registry.ts` and a new per-firm seed migration
  (`20260901T020000_seed-matter-search-permission.sql`) plus its journal entry — the likeliest
  collision with another stream, since every permission-adding branch appends to both.
- `apps/web/src/lib/api/request.ts` — took an optional `AbortSignal`, additive.
- `apps/api-worker/test/conformance.test.ts` — the operation list and the namespace map. **Note for
  anyone rebasing:** this suite was already red on `main` when the stream started (the notes routes
  landed without their six operation ids or a `notes` namespace binding); both are fixed here, so a
  branch that also fixes them will conflict on those lines.

**Deliberately not touched:** anything under `apps/web/src/lib/file-manager/`. Owner flag M2 settled
on one results surface with the Files group drawn by the file manager's own row machinery, and that
adoption is follow-on work rather than part of this slice — the file manager's Search Results view
is untouched and still works as it did.

**Next:** file contents, which wait on the search Container being deployed — until then the port
answers `engine-not-implemented` and the Files group says so rather than implying it looked. The
sources whose text is already in D1 are done (time narratives, cost descriptions, calendar titles,
invoice line descriptions and numbers), each behind the load-profile measurement, because a `LIKE`
scan bounded by one matter is genuinely bounded for notes and was NOT bounded for parties until the
gate caught it.

## The conflicts read surface — design only, nothing built

Second stream on this branch, on the owner's direction of 2026-09-02. Design is at
[`docs/specs/2026-09-02-conflicts-read-surface-design.md`](../../specs/2026-09-02-conflicts-read-surface-design.md).

The conflicts engine, its append-only log and the screens are all built; what is missing is six
READS the screens already render disabled affordances for, each named in
`apps/web/src/lib/conflicts/conflicts-gaps.ts`. The design's one substantive finding is that the
first and most valuable of them needs no new machinery — `readSubjectFactsBatch` already resolves a
set of entity ids to names on the write path, so naming the matched party is an enrichment of the
existing check read rather than a new Directory batch endpoint (which would be a wider grant than
this surface should own).

**Anyone touching conflicts should know:** this stream has written no code there, and the three log
tables are append-only with `RAISE(ABORT)` triggers — nothing in the planned work writes to them.

**Waiting on the owner:** two questions in section 8 — who may read the firm's conflicts policy, and
what makes a re-surfaced hit "the same hit" as one a reviewer already answered. Four of the six reads
do not wait on either.
