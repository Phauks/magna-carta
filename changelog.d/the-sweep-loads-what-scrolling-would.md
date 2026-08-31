---
category: Fixed
audience: public
---

**Full-page captures load what scrolling would, and the viewer fits the monitor.** Below-the-fold
images lazy-load on scroll, so a full-page screenshot without a scroll captured gray placeholders
under the first viewport: the snapshot call now injects a bounded scroll sweep (`addScriptTag`,
viewport steps to the bottom or thirty steps, whichever first, then back to the top) with the
settle timeout raised to cover the loads it triggers — bounded so an infinite-scroll feed cannot
hold a capture hostage. And the viewer's full-height column double-claimed the canvas: the page's
`h-full` took 100% of the canvas height on top of the Back-to-Tools row above it, so the frame's
bottom edge always sat below the fold and the screenshot's inner scrollbar with it. The tools
layout now owns the height column (nav row fixed, slot takes the remainder), so the viewer sizes
to the monitor exactly and normal-flow tool pages keep scrolling the canvas as before.

## Public

**Captures now include the images further down the page.** The isolated browser scrolls through
the page once before taking its screenshot, so pictures that only load as you scroll are in the
shot. And the viewer now fits your screen exactly: no more bottom edge hanging below the window,
and the screenshot scrolls inside its frame.
