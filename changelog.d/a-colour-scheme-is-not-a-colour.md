---
category: Fixed
audience: public
---

**The white flash between screens, the last two steps.** The document base landed the colour scheme and the root ink; this carries the same rule to the two places a flash survived it.

**A colour scheme is not a colour.** `color-scheme` buys the browser's own generic canvas for the mode, not the surface the product is drawn on — and against a 99% warm surface the light one reads as a flash to pure white, which is how the defect was reported. Every shell paints its background on an element inside the Svelte tree, so the canvas is what shows wherever that tree does not cover the viewport: the boot of a hard load, the frame where leaving the workspace for Account or sign-in swaps one shell for another, an overscroll, the scrollbar gutter. The root now takes `background-color` from `--mc-surface-default`, and a background on the root propagates to the canvas, so no unpainted layer is left to show through.

**A stylesheet cannot reach the window before it arrives.** `applyThemeToDocument` writes `color-scheme` as an inline style, mirrored in the boot script — the same fact `base.css` declares, written where a separate request has not landed yet. With `ssr = false` behind an `index.html` fallback the served document has an empty body until the application mounts, so that window is the entire boot, and the longest of the flashes.

Both are pinned: the root's paint joins the two facts already asserted in `document-base.test.ts`, the inline write joins the boot-script mirror, and `theme-preference.test.ts` holds it to moving with the dark class in both directions.

## Public

**The last of the white flash is gone.** Opening the app, or moving between your workspace and the account and sign-in screens, no longer shows a bright frame before the screen appears — including the one on a cold load, which was the longest of them. Screens now come up on the surface colour you were already looking at, in whichever theme you use.
