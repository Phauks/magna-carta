---
category: Changed
audience: internal
---

The matter's header band goes from 111px to 76px, and `Masthead.Root` learns a `density`.

The section strip already shared the band. What was left was the identity block, which spent three rows on itself: the ledger line, the title, the citation. Now it spends two — the matter number and its status seal lead the citation rather than holding a row above the title — and the title takes the Masthead recipe's new `compact` density, 2rem down to 1.5rem. The step lives in the recipe because the masthead is the one door to the display serif, and a screen that can set `text-2xl` on the Title has taken that door off its hinges.

The change that actually moved the number was on the other side. Six settings were measured, and three that look nothing alike came out at exactly 90px: the inline-end column was the overflow control stacked over the strip — 40px + 8px + 41px = 89px — and it floored the band however short the identity got. Putting the whole identity on one line bought nothing at all. Moving the control onto the strip's own row makes that column 41px, and the identity block sets the height again.

152px of matter chrome at the start of this work, 111px after the strip moved off its own row, 76px now, at every canvas width. A third density step was built, measured and dropped: at 1.25rem the display face is close enough to the citation that the register's scale contrast nearly goes, and it bought nothing over the structural saving.
