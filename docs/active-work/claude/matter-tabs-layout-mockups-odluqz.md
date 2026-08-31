---
worktree: C:/dev/magna-carta-worktrees/claude/matter-tabs-layout-mockups-odluqz
area: Matter chrome — the section navigation moves into the header's empty inline-end half
status: building
touches: apps/web/src/lib/matters, apps/web/src/lib/maturity, docs/conventions/design-corrections.md, changelog.d
---

The selection round is decided. The owner chose the arrangement that puts the actions on the title's
row and the section strip beneath them, both packed to the band's inline end, and rejected the
vertical section rail as overstepping what the main shell does. The candidate gallery has been
deleted; `matter-header.svelte` now owns the whole band and `matter-section-nav.svelte` draws no rule
of its own.

Touches two things outside `matters/`: `maturity.ts` — `alpha` and `beta` present as null now, so the
Alpha pillboxes are gone from the sidebar and the tools listing as well as the matter tabs — and
`docs/conventions/design-corrections.md`, which records the round. Anything editing either should
sync first.
