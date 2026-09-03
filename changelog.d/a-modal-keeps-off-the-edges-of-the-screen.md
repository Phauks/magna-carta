---
category: Changed
audience: public
---

**Every windowed modal panel is centred in a stage that keeps it off the screen's edges.** `Dialog.Content` and `AlertDialog.Content` render Bits' panel inside `mc-modal-stage` (`packages/design-system/src/lib/styles/recipes/modal-stage.css`): a fixed box pulled in from every edge by the new `size.modal-gutter` token (32px), which centres the panel with flex and caps its height by flex shrinking, so the panels carry no `max-h-*` utility any more. A panel that must sit elsewhere (the command palette) leaves the stage with the `fixed` utility; the stage drops its gutter when its panel is expanded; the print sheet flattens it on paper. Pinned in `test/modal-stage.test.ts` and ruled in `docs/conventions/design-corrections.md`.

## Public

**A window opened over the application now keeps a margin of screen around it on every side.** On a laptop, a long record or a long form used to run from the top edge of the screen to the bottom edge, and the widest windows touched both sides too. Every window, dialog and question now opens inside a margin on every side: one that fits is exactly as tall as what is in it, and one that does not fit stops at that margin and scrolls inside. Filling the screen is still one press away, and still fills it to the edges.
