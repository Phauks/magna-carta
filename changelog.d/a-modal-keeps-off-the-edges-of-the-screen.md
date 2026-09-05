---
category: Changed
audience: public
---

**Where a modal panel sits on the screen is now one module, and it keeps every panel off the screen's edges.** `styles/recipes/modal-stage.css` holds every placement rule: `mc-modal-stage`, the viewport pulled in by the new `size.modal-gutter` token (32px), centring its panel with flex and capping it there by flex shrinking; and `mc-modal-panel`, what makes any panel its child, so the panel recipes keep only their look and carry no `max-h-*` utility any more. `internal/modal-stage.svelte` is the stage's one piece of markup, rendered by `Dialog.Content` and `AlertDialog.Content`. `internal/modal-placement.ts` is the closed placement axis (`centered | anchored`), stamped on every panel and taken by `Dialog.Content` as `placement`; the command palette says `anchored` instead of reaching for a utility. `modal-geometry/` is the diagnostic: a Playwright sweep that measures every modal specimen at every screen size in its matrix, screenshots it, and fails an edge nearer than the gutter. Pinned in `test/modal-stage.test.ts` and `test/modal-geometry.test.ts`; ruled in `docs/conventions/design-corrections.md`.

## Public

**A window opened over the application now keeps a margin of screen around it on every side.** On a laptop, a long record or a long form used to run from the top edge of the screen to the bottom edge, and the widest windows touched both sides too. Every window, dialog and question now opens inside a margin on every side: one that fits is exactly as tall as what is in it, and one that does not fit stops at that margin and scrolls inside. Filling the screen is still one press away, and still fills it to the edges.
