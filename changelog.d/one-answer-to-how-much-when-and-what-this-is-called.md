---
category: Changed
audience: internal
---

The display vocabulary and the caps label each become one thing, and the registry starts naming the surfaces it had been leaving out.

Money, counts and civil dates were presented from inside the table's typed columns, which is where a column author found them and nowhere a details panel would think to look. They move to `packages/design-system/src/lib/formatters/`, beside the answers for how long, when, who and which version, and the table re-exports them so every existing import still resolves. The move is not a bug fix and the note in `money.ts` says so: the float path only starts disagreeing with an exact minor-unit sum once a single row passes roughly a trillion of the major unit, which was measured rather than assumed. Two of the four answers to "how long" — `hoursFromMinutes` and `decimalHoursText` — turned out to have no callers at all outside one test, and are gone.

The caps field label existed 101 times, hand-written, in two tones that disagreed: the invoice window alone used both. Worse, 77 of those sites reached for an inline `letter-spacing` style to put back the tracking every design-system recipe already carries, which is raw CSS in a codebase that forbids it. `FieldLabel` takes the register the masthead eyebrow and the eyebrow link already agreed on and stops it being retyped; it renders whichever element the caller's document structure needs, because the alternative is the callers that need a `dt` or a heading carrying on by hand.

Eight shared surfaces the one-implementation registry had never named — `DataTable`, `Masthead`, `TopBar`, `EmptyState`, `LabelledField`, `FieldRow`, `StatusMark` and the new `FieldLabel` — now have entries. The registry's promise is that no second file claims the name; it had not been making that promise about the components most likely to be forked.
