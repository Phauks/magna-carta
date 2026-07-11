# eyebrow-link

**Scope:** Add a new design-system `EyebrowLink` component and retire the app-level workaround that
existed because it did not. Branched from `slice-0-7b-app-shell`; merges back to `main`.

## The change

A masthead eyebrow that navigates — a letterspaced small-caps anchor in the subtle text register.
It is a label, not a control, so it carries no control height (`min-block-size`): the box hugs its
ink and, with `align-items: flex-start`, the leading icon's box sits flush against the block-start
edge. A consumer that frames it with equal padding then reads symmetrically — the arrow's ink lands
the same distance from the frame's top as from its inline start.

WCAG 2.5.8's 24x24 pointer target is met by a transparent `::before` overlay that enlarges the hit
area without enlarging the box (chosen over padding + negative margin, which needs `calc()` / a
negative length the recipe token grammar cannot express).

The Tools back-link (`apps/web/src/lib/navigation/back-link.svelte`) now composes the component,
dropping its inline `letter-spacing` style, its negative-margin calc, and the `Button` import.

## Files expected to be touched

- `packages/design-system/src/lib/components/eyebrow-link/**` — new component (svelte, css, index)
- `packages/design-system/src/lib/styles/components.css` — one `@import` line
- `packages/design-system/package.json` — one export-map entry
- `packages/design-system/src/stories/eyebrow-link.stories.svelte` — new stories
- `apps/web/src/lib/navigation/back-link.svelte` — rewritten to compose the component
- `changelog.d/eyebrow-link.md`, `status.d/eyebrow-link.md` — fragments

## Overlaps

`components.css` and `package.json` in the design system are shared; touched here with a single
additive line each (a new `@import` and a new export key), so the append is collision-cheap. The
Tools `+layout.svelte` and everything under `apps/web/src/lib/tools/**` and
`apps/web/src/routes/(app)/tools/**` are owned by another stream and are NOT touched.
