---
category: Fixed
audience: public
---

**The template library rendered as the crash screen on every visit.** `CreateControl` refuses a noun longer than its fixed width holds, `/documents` shipped `noun="Template"` against a budget of seven, and the refusal is a `throw` raised while the screen renders — so the render boundary replaced the whole page and the defect read as a 500 rather than a label that did not fit.

The owner's ruling was to re-measure the one width: `size.create-control` is 140px (was 136px) and `CREATE_NOUN_MAX_LENGTH` is eight (was seven), so every create control in the product moves together rather than one screen stretching the control for its own label. The budget is written down as the measurement it is — "New Template" sets 81.6px in the reading face at the small size, and a 140px control leaves 80px of label after the padding, the glyph and its gap.

Two gates now read a noun before it renders. `pnpm run lint:matter-create-control` read create nouns only out of the matter section registry, where they are declared as data, and never out of a screen's own markup, where this one was written; it reads both now and names the file and line. `apps/web/test/documents-library-screen.test.ts` mounts the screen under the real root layout, so a render-time throw of any kind there fails in the battery instead of on the deployed site.

## Public

**Documents opens again.** Every visit to the firm's template library met an error screen instead of the catalogue. The button that registers a new template had a label one character too wide for it, which stopped the whole page from drawing rather than just the button; the control is slightly wider now and the page loads normally.
