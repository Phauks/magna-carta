---
category: Changed
audience: internal
---

`ActionDialog` gained the seams its first fifteen callers were writing by hand, and the design system gained the maturity family and two field primitives.

The primary pane is a real `<form>` and the commit is its submit button by id, so Enter commits in every panel and a disabled commit stops it; Ctrl+Enter or Cmd+Enter commits from a textarea. `subtitle` takes a string (twelve of fourteen were plain text; the eight that could be are now one attribute). `commitSoon: { reason }` renders the commit inside the Soon affordance for an act not served yet — the shell wraps its own control, so the bar still holds one commit in its source and `footer-set` is unchanged.

`apps/web/src/lib/maturity/` moved whole into `@magna-carta/design-system/maturity` — the stage model, `MaturityBadge`, `MaturityDot`, `SoonAffordance` and its wording — because the shell cannot import the app; thirty-five files changed an import path, the two tests moved with the module, and `SoonAffordance` is registered in `lint:one-ui`'s one-implementation registry with three stories in the catalog.

`LabelledField` (label, control, hint, error; the id minted, the description joined, an error marked invalid, the control's attributes handed over as `props` to spread) and `FieldRow` (two or three across) replace the column written fifty-six times and the row written sixteen. The field's gap is the panels' space-8 where the superforms-bound `Form.Field` uses space-4; the recipe says so rather than picking for the owner.
