# app-shell-canvas-corner

**Scope:** Round the corner where the top bar, the sidebar, and the work surface meet, at the shell's
top-inline-start. Branched from `slice-0-7b-app-shell` (which owns the app shell); merges back there.

## The change

`<main>` takes the rounded corner, not the canvas div.

The canvas div (`app-shell.svelte`, the element carrying `view-transition-name: mc-app-canvas`) paints
`bg-chrome-surface` instead of `bg-surface-default`. `<main>` paints `bg-surface-default` and rounds its
start-start corner. The light work surface then tucks under the dark header and against the dark rail,
and what shows in the arc is chrome — continuous with the top bar above and the sidebar beside it.

## Why not the canvas div itself

The canvas's top-inline-start corner is the **top bar's** corner, and the top bar paints
`--mc-chrome-surface`, as does the sidebar. `sidebar.css` states the intent: the chrome-to-canvas
surface contrast *is* the edge, and the brand corner flows into the top bar as one smooth chrome
surface. Rounding the canvas would cut a light notch into that unbroken band.

It would also make the `mc-app-canvas` snapshot non-rectangular. `animations.css` records why that is
dangerous: clipping the canvas pair once exposed a one-device-pixel column where the root snapshot's
light page background showed through the dark header, flashing a white line. An anti-aliased arc
reintroduces that class of bug on every sidebar collapse, expand, hover-peek open, and hover-peek close.

Extending the sidebar's surface behind the corner was also rejected: sidebar and canvas are
non-overlapping flex siblings, so it would require either absolute positioning or a transparent canvas
corner — and a transparent canvas snapshot is exactly what causes the outgoing page's text to show
through the incoming one during the collapse animation.

Rounding `<main>` keeps `mc-app-canvas` full-bleed, rectangular, and opaque. The view transition never
sees the radius.

## Files expected to be touched

- `apps/web/src/lib/components/app-shell.svelte` — two class changes
- `packages/design-system/src/lib/components/sidebar/sidebar.svelte` — comment repair only (see below)

## Also worth fixing while here

`sidebar.svelte` header comments still describe a since-removed absolute-positioned overlay peek. The
shipping behaviour is an in-flow width change that pushes the canvas. The CSS is authoritative; the
comments mislead anyone designing against them.

## Overlaps

`app-shell.svelte` is owned by `slice-0-7b-app-shell`. That stream is not currently editing this file,
but sync before merging.
