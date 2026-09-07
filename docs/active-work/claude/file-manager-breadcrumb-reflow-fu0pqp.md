---
worktree: /home/user/magna-carta (remote session)
area: The file manager's folder path — Home pinned outside the scroll, a deep path folds behind an ellipsis, and the toolbar stops changing height when a scrollbar arrives
status: review
touches: apps/web/src/lib/file-manager/file-manager-toolbar.svelte, apps/web/test/file-manager-toolbar.test.ts, packages/design-system/src/lib/components/breadcrumb/, packages/design-system/src/lib/components/sidebar/, packages/design-system/src/lib/styles/recipes/scrollbar.css, docs/conventions/file-manager-rulings.md, changelog.d/
---

The owner's report of 2026-09-07: a long breadcrumb reflowed the file manager's toolbar as the
horizontal scrollbar came and went, and Home scrolled out of reach with the rest of the path. Home is
now pinned beside back, forward and up; the path folds its middle behind an ellipsis menu using the
design system's `collapseBreadcrumb`, extracted from `Breadcrumb` so both surfaces fold alike; and
the strip hides its scrollbar through a new shared `mc-scrollbar-hidden` recipe, which
`Sidebar.Content` now carries in place of its own copy of those declarations. A concurrent stream
touching the sidebar's scroll region or the `Breadcrumb` component should expect those two files to
have moved.
