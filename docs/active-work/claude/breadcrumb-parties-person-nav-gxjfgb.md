---
worktree: /home/user/magna-carta (remote session)
area: A directory record is one window wherever it opens — the entity window in the New Person screen's shape, replacing the tabbed record screen; every host (directory list, matter parties, overview, conflicts hit) opens it in place
status: review
touches: apps/web/src/lib/directory/{entity-window.svelte,entity-window-model.ts,entity-presentation.ts,edges-pane.svelte,duplicates-pane.svelte}, apps/web/src/lib/matters/party-standing.ts, apps/web/src/lib/conflicts/hit-window.svelte, apps/web/src/routes/(app)/directory, apps/web/src/routes/(app)/matters/[id]/{parties,overview}, tooling/lint-back-navigation/back-navigation.mjs, docs/specs/2026-09-02-directory-linking-design.md, docs/specs/2026-06-12-page-archetypes.md, docs/conventions/design-corrections.md, docs/conventions/ui-design.md, docs/user/features/{directory,matter-parties}.md, roadmap.d/core-domain.md, docs/now.md, changelog.d/, docs/decisions/pending/
---

The owner's ruling of 2026-09-05: a party opened from a matter must not leave the matter, and a
directory record has one surface — the window, in the New Person screen's shape — wherever it
opens. `apps/web/src/lib/directory/entity-window.svelte` is that window; the tabbed record screen
under `/directory/[id]` is gone and its address redirects to `/directory?record=<id>`, which the
directory list opens the window from. A concurrent stream that links to a record should use
`entityRecordHref` as before, or host `EntityWindow` with `onOpen` where it wants the record in
place; nothing should add a screen for a record.
