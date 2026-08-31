---
category: Added
audience: internal
---

`/developer-console/matter-chrome` — four candidate arrangements of the matter chrome, beside today's, for choosing where the section navigation lives.

A matter spends two rows before its content: the masthead, whose inline-end half carries one overflow control and otherwise nothing, and then the section strip on a row of its own. The candidates spend one row instead — sections on the title's row, sections stacked under the actions, one working line carrying everything, and a vertical rail beside the work.

Each caption measures its own chrome band and subtracts it from today's, so the recovered height is read off the rendered arrangement rather than asserted. That measurement is what makes the round useful: at desk width three of the four recover between 42 and 104 pixels, and at a 1024 canvas the two that share a row with the title wrap it and come out TALLER than the chrome they replace. Nothing about that is visible in a drawing.

The one shipping change is an extraction: the strip's fold arithmetic moves to `apps/web/src/lib/matters/section-overflow.svelte.ts`, so the live nav and the candidates cannot fold their tabs by two different rules. The matter screens are otherwise untouched — this is a selection round, and the chosen arrangement folds back into `matter-header.svelte` / `matter-section-nav.svelte` when there is one.
