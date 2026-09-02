---
worktree: /home/user/magna-carta (remote session)
area: One chassis under both modal shells — the pane system extracted from RecordWindow so ActionDialog can carry a context pane
status: building
touches: packages/design-system/src/lib/styles/recipes/, packages/design-system/src/lib/styles/components.css, packages/design-system/src/lib/components/record-window/, packages/design-system/src/lib/components/action-dialog/, packages/design-system/src/stories/, tooling/lint-one-ui/, apps/web/src/lib/matters/new-matter-dialog.svelte, docs/specs/, changelog.d/
---

The record window's frame — header band, fit-first/cap-second body, primary pane that stops at its
measure beside a context pane that takes the rest, fixed action bar — becomes an internal recipe
both shells sit on. RecordWindow keeps every class name and every pixel; ActionDialog moves onto the
same frame and gains an optional `context` pane. `new-matter-dialog.svelte`, which hand-builds
exactly this frame in 647 lines, is the proof and migrates last.

**A concurrent stream should stay out of `packages/design-system/src/lib/components/record-window/`,
`action-dialog/`, `styles/`, and `apps/web/src/lib/matters/new-matter-dialog.svelte` until this
lands.** The header-set rule in `tooling/lint-one-ui/rules.mjs` changes from an exact attribute match
to a class-token match so the group element can carry the frame's class too.
