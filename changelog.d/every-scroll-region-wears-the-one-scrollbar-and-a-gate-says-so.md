---
category: Fixed
audience: internal
---

**Every scroll region wears the design system's own scrollbar, and a gate keeps it that way.** The
slim tokenised scrollbar has existed as the `mc-scrollbar` recipe since the app shell was built, and
twenty-odd regions were not wearing it — so on real data, and only on real data, they grew the
operating system's instead: a fat grey bar with stepper arrows in Chrome, something else on macOS, a
third thing in Firefox. It is the only chrome on those screens the design system did not draw, and it
appears exactly when content outgrows its box, which is to say never in the state the screen was
built in.

The worst of them was the `ActionDialog`'s own fields pane. Nothing in its markup says "scroll" —
`.mc-modal-frame-pane` says `overflow-y: auto` in CSS — so *every panel in the product* had it, and
the conflicts check panel is where the owner saw it. The `Dialog`, `AlertDialog`, `Sheet` and
`RecordWindow` shells were the same. The record window's tab strip takes `mc-scrollbar-hidden`
instead, with a `ScrollEdgeHint` beside it: it is `flex: none`, so a horizontal bar arriving under
the labels would push the pane below it down by its own height the moment a record gained a tab.

`pnpm run lint:scrollbar` (`tooling/lint-scrollbar/`) now fails any element that can scroll and does
not name one of the two recipes. What "can scroll" means is **derived, never listed**: the Tailwind
utilities that draw a scrollbar (`overflow-auto`, `overflow-scroll`, both axis forms, under any
variant), plus every design-system class whose own stylesheet declares a scrolling `overflow` — read
out of the CSS at scan time, so a recipe that starts or stops scrolling moves the gate with it. It
checks the pairing on one class expression (a `class` attribute, `mergeClasses` calls and all, or a
shared class constant), strips comments before it reads anything, and fails on the **premise** rather
than the files if the recipe classes are ever renamed away.
