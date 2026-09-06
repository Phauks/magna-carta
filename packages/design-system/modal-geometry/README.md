# Modal geometry — every modal panel, on every screen, measured

A Playwright sweep that loads each modal specimen in the catalog
(`src/stories/modal-geometry.stories.svelte`: every shell, already open, one story per way a panel
can meet the screen) at each screen size in [`matrix.ts`](matrix.ts), measures where the panel
sits, prints one line per panel, leaves a screenshot, and fails any panel that breaks the stage's
rule. The rule, and the recipe that keeps
it, are in `src/lib/styles/recipes/modal-stage.css`: a windowed panel keeps `size.modal-gutter` of
screen on every side, and an expanded panel touches every edge.

It exists because the defect it guards was only visible on a screen the reviewer did not have. A
long record window ran edge to edge on a laptop and looked fine on every monitor in the room; the
sweep is how a laptop's screen is looked at from a desk that has none.

## Running

```
pnpm --filter @magna-carta/design-system run modal-geometry
```

It starts the Storybook dev server on port 6006 if one is not already running (and reuses one that
is), so a recipe change is measured the moment it is saved. Each row prints as it is measured:

```
laptop-1366x657 record-window-too-long: 1280 x 593 edges L43 T32 R43 B32
```

The size is the panel's; the edges are its distance from the left, top, right and bottom of the
viewport. Screenshots land in `test-results/` (git-ignored), one per row, named
`<viewport>--<specimen>.png`. A failure names the edge and the distance:

```
bottom edge is 0px from the screen; the gutter is 32px
```

## Reading a failure

- **A windowed panel touches an edge** — the panel is not inside the stage, or has a height or
  width utility that reaches past it. The panel must carry `mc-modal-panel` and render inside
  `ModalStage` (`src/lib/internal/modal-stage.svelte`); it must not carry `max-h-screen`, `h-screen`
  or `w-screen` while windowed.
- **The gutter reads as `NaN`** — the panel is not a descendant of an element carrying
  `data-modal-stage`. Every modal panel renders inside the stage, anchored ones included.
- **An expanded panel keeps a gutter** — the stage did not see `data-expanded="true"` on its direct
  child; the panel carrying that attribute must be the stage's own child.
- **Only one viewport fails** — that is the point of the matrix. The row's `stands_for` says which
  real screen it is; reproduce by resizing a browser to that size.

## Growing it

- **A new screen size** is a row in `VIEWPORTS` with a name, a size in CSS pixels and what it
  stands for. Use the size the browser reports, not the panel's resolution.
- **A new panel, width or placement** is a story in `src/stories/modal-geometry.stories.svelte`
  that renders the panel already open, with no trigger and no play function, and a row in
  `SPECIMENS` naming it; set `expanded` when the story opens its panel expanded, so the sweep
  expects it to fill the screen.
- **A new rule** about where a panel may sit is a function in [`geometry.ts`](geometry.ts), unit
  tested in `test/modal-geometry.test.ts` without a browser, then applied in the spec.

Chromium only, like the visual-regression harness beside it; pixels are compared there, boxes are
measured here.
