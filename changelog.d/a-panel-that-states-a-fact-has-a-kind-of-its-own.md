---
category: Changed
audience: internal
---

`ActionDialog` has a fourth kind, `reading`, and the matter-status window is its first caller.

A reading panel states a fact and seats any step it offers beside that fact — Close Matter, Reopen — rather than in the action bar, whose one control says "Close" because nothing was begun. The props are now a discriminated union on `kind`: the acting kinds require a commit exactly as they did, and the reading kind forbids one, so neither arm got weaker to admit the other. The kind table gained a row (`commitVariant: null`) and the bar renders its commit only when there is a variant to render it in.

The status window had merged composing `Dialog.Content` by hand — the shape the `hand-composed-modal` rule refuses — and left `main` red on `lint:one-ui`, because nothing before merge ran the rule. It migrates rather than taking an allowance: it postdates the shell. Two visible changes on that window: "Done" reads "Close", and the control is no longer disabled while a step is in flight, since the shell owns the dismissal.
