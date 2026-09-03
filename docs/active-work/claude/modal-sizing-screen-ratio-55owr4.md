---
worktree: C:/dev/magna-carta-worktrees/claude/modal-sizing-screen-ratio-55owr4
area: The modal shells' relationship to the screen — a gutter every windowed panel keeps, on every screen size
status: review
touches: packages/design-tokens/tokens/primitives/dimension.json, packages/design-tokens/test/golden, packages/design-system/src/lib/styles/recipes/modal-stage.css, packages/design-system/src/lib/styles/components.css, packages/design-system/src/lib/components/dialog, packages/design-system/src/lib/components/alert-dialog, packages/design-system/src/lib/components/record-window/record-window.svelte, packages/design-system/src/lib/components/print-sheet/print-sheet.css, packages/design-system/src/lib/internal/frame-expansion.svelte.ts, packages/design-system/CLAUDE.md, apps/web/src/lib/components/command-palette.svelte, docs/conventions/design-corrections.md, changelog.d
---

The owner, on a laptop, found the modals taking the screen: a tall record window ran edge to edge
vertically and the record-width panels touched both sides. This stream adds the modal stage — a
fixed box pulled in from every screen edge by the new `size.modal-gutter` token that both `Dialog`
and `AlertDialog` centre their panel in, and that caps the panel's height by flex shrinking — so
every dialog, action dialog, record window and question keeps 32px of screen around it, and only
the expand gesture fills the screen. The command palette steps out of the stage with the `fixed`
utility to stay anchored on its trigger; the print sheet flattens the stage on paper.

Measured before and after in Chromium at seven viewports (1280x720 through 2560x1440) over the
Storybook stories; the record window's windowed height and the dialog panels' positioning are the
only geometry that changed. Streams building forms and record windows on the shells need no change.
