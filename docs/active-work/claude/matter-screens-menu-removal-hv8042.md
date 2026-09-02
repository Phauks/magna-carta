---
worktree: C:/dev/magna-carta-worktrees/claude/matter-screens-menu-removal-hv8042
area: Matter chrome — the section strip regrouped, the header's overflow menu and Other removed, Magnus added
status: building
touches: apps/web/src/lib/matters, apps/web/src/routes/(app)/matters, apps/web/src/lib/tools/speed-test, roadmap.d/ai.md, docs/conventions/design-corrections.md, docs/specs/2026-06-12-page-archetypes.md, changelog.d
---

Two owner rulings against the matter screens on 2026-09-01. The header band's overflow (...) control
is removed — its only item was the status's lifecycle action, shipped disabled and marked Soon, so
the menu cost a control's width to say nothing. And the Other section leaves the registry and the
route tree: a section named for what it is not is not a place anybody navigates to. In the same
round Magnus takes a matter section — a `soon` stub standing alone on the row, so the assistant has
the matter-scoped home the sidebar destination's own comment already anticipated.

The strip itself is then regrouped (owner's choice between three directions): six top-level entries,
Overview · Files · Money ⌄ · Record ⌄ · People ⌄ · Magnus, with the measured fold kept underneath as
a backstop rather than as the mechanism. `sections.ts` gains the arrangement beside the registry and
loses the `core` flag.

Concurrent streams should not step on: `apps/web/src/lib/matters/sections.ts`,
`apps/web/src/lib/matters/matter-header.svelte`, and the Controls-and-patterns block of
`docs/conventions/design-corrections.md`.
