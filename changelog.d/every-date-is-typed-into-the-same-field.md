---
category: Changed
audience: internal
---

**Every date on the platform is now entered through one control.** Sixteen surfaces held a native `<Input type="date">`; all sixteen are the design system's `DatePicker`, and `pnpm run lint:date-handling` fails a native date field wherever it is written — the design system included. There is no allowance list any more: it is empty and a test asserts it stays empty.

It had been recorded rather than failed, because whether the native control was good enough for some fields looked like a design question with real trade-offs. It was not one. The design system's own notes had already called the native date types "a thin interim", and only the component can carry a firm-configured week start or a locale-aware week — the native `type="week"` is hard-locked to ISO 8601, Monday-start, not configurable. Two controls also meant two behaviours on the same screen, and the split was quietly growing: it reached sixteen entries on a merge while the gate stayed green.

Three things had to exist first. The picker gained the Input's own `size` scale, imported rather than redeclared, so a date field and the text field beside it can be set to one row height — that is what let a column's date-range filter, two boxes inside a menu, keep its compact geometry. It gained an `aria-label` that reaches the segment group: the property spread goes to a root element that renders no DOM, so an `aria-label` written the obvious way disappeared without a warning and left the field unnamed. And the conversion between the picker's value and the `YYYY-MM-DD` text a record holds moved to sit beside the picker, because a design-system component cannot import an app; screens still reach it at the same import path.

One thing was given up, recorded here so it is not rediscovered as a defect: the invitation screen's birthdate field carried `autocomplete="bday"`, and a browser fills a birthday only into a native date input it recognises as one. The picker has no `name` or `autocomplete` to pass through, so that date is typed now, like every other one.

Two smaller repairs came with it. `startOfCivilMonth` joins `endOfCivilMonth` in `@magna-carta/civil-time`, so the draft-bill dialog's billing period starts from the month's parts instead of `` `${today.slice(0, 8)}01` `` — correct, unreadable, and one edit from being a day out. And the `FieldRow` catalog specimen now holds a real date field, which makes it the specimen for the one thing the two label recipes have to agree on: they must measure the same, or a date field starts a few pixels below the fields beside it.
