---
category: Changed
audience: internal
---

**The loading region holds a read's whole state set, states a stall, announces its finish and measures every settle.** `LoadingRegion` gains `failed` with a `failure` snippet (rendered first, whatever else is true, so the failure-exit ruling is structural), `empty` with an `emptyState` snippet, `refreshing` for a re-read that keeps the content on screen while marking the region busy, and `onRetry`. Past fifteen seconds in flight the region says "Still reading …. This is taking longer than it should." above the shape and offers Retry, so a permanent skeleton cannot happen by construction. One status line carries the sentence and then says the read finished. Every settle writes a User Timing measure and dispatches `mc-loading-settled`; the app shell records it as a `loading` breadcrumb, so a report says which reads a member waited on and for how long. The four-branch chain around every region in `apps/web` folds into the region, and the Refresh control and the directory's duplicate check use `refreshing` in place of hand-written busy marks.

**Every fixture's words come from one invented vocabulary.** `@magna-carta/design-system/loading-fixtures` supplies people, organizations, matters, dates, amounts and a sentence by index, plausible in length and provably not a client's; the story, the gallery and every surface draw from it.

**Two more gates.** `silent-loading` fails a null-sentinel branch that renders nothing or a bare "Reading…" sentence, the gap the first rule could not see; `fixture-shape` fails a fixture that renders a component its region's children never do, with `{@render}` expanded to the snippet it names. Both are proved against known-bad input. The developer-console gallery adds the state set, and a fitness test measures the bone's contrast on every surface in every theme and mode (1.16:1 to 1.59:1 today, against a 3:1 non-text target the owner has yet to rule on) and pins a floor under it.
