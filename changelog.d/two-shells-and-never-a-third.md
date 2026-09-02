---
category: Added
audience: internal
---

`ActionDialog` — the one panel an act is asked for in, and `RecordWindow`'s modal peer.

Thirty-four files in `apps/web` composed a modal panel by hand, and each re-derived the same seven mechanics: the open flag, the reset when it opens, the busy flag, the commit, the failure band, the refusal that disables the commit, and the footer. They had already drifted in every way drift was available — thirteen said "Cancel" where five said "Close" for the identical gesture, eighteen suppressed the corner dismiss where twelve kept it. **And not one of the thirty `Dialog` panels asked before it discarded**, so a stray Escape threw away a half-written write-off, credit note or new matter in silence. `RecordWindow` was given a guard for exactly that and could not lend it.

The shell owns what no caller may re-derive, and owns it by having no prop for it: the footer's geometry and the order of its two controls, the dismissal's word, the busy state, whether the corner dismiss shows, which primitive renders the panel, and the one close path every exit runs through. A caller differs on a closed set — a `fields` snippet, a `notice` slot the app puts its failure band in, `kind`, `width`, and a commit that reports `committed` or `refused`. `kind` is the line that carries the most weight: a form is a `Dialog`, a question is an `AlertDialog` with the role and the dismissal behaviour that implies. Four panels reached `AlertDialog` before this and thirty did not, with no rule behind the split.

The unsaved-work guard moved out of `record-window.svelte` into an internal both shells consume, so the product asks that question in one voice rather than in one window.
