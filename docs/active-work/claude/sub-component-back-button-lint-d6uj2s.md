---
worktree: /home/user/magna-carta (remote session)
area: One screen header for the whole application — title, eyebrow, citation, actions and the way back, plus the gate that keeps it one
status: review
touches: apps/web/src/lib/screen/, apps/web/src/lib/navigation/{back-link.svelte,destinations.ts}, apps/web/src/lib/matters/matter-header.svelte, apps/web/src/lib/{settings,account}/components, apps/web/src/routes (every screen with a title), tooling/lint-back-navigation/, package.json, vite.config.ts, docs/conventions/ui-design.md, docs/user/features/directory.md, changelog.d/
---

The owner's direction: entering a sub-screen of a main screen must put a way back at the top of its
header — and, on 2026-09-03, that the header itself be ONE component, because the variety across
twenty-four hand-assembled headers is what made the missing way back invisible in the first place.
The way back shows its destination in miniature: the sidebar's own glyph beside the sidebar's own
name, so a reader learns where the link lands.

`apps/web/src/lib/screen/screen-header.svelte` is that component — the way back, the eyebrow, the
title, the citation line, the actions, and a trailing column for the matter band. Every screen in
the application composes it; `Masthead.Root` now appears exactly once outside the design system.
A screen names its destination by registry id (`back="directory"`), so the href, the label and the
glyph come from one place and a typo is a type error.

`pnpm run lint:back-navigation` holds all of it: every route under another route's page names a
`back`, the destination resolves to that page's own path, and nothing hand-assembles a header.

A concurrent stream adding a screen will meet the gate. Anything touching a screen's masthead should
expect it to have moved to the component.
