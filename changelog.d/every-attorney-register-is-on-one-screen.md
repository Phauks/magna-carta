---
category: Changed
audience: public
---

**Attorney License Lookup lists all fifty-one registers instead of asking which one you want.** The
state `ChoicePicker` and the single revealed register card are gone; the screen is now
`DataTable.Grid` over `attorneyLicenseRows()`, one row per state, sorted by state name. Every answer
the tool could ever give is a hyperlink and there are only fifty-one of them, so the picker was
hiding fifty links and, with them, the two questions a list answers for nothing: is a state covered,
and which registers are not encrypted.

`attorney-license.ts` keeps its DOM-free split and swaps its API — `licensingStateChoices()` and
`registerForState()` out, `attorneyLicenseRows()` and `attorneyLicenseColumns()` in. The columns are
State (anchored, carrying the link), Code, Register, Connection, and Address hidden by default. The
plain-HTTP caution stops being an `Alert` that appears only for a state already chosen and becomes
the Connection column: a `set` filter over the declared `CONNECTION_STANDINGS`, so narrowing to the
unencrypted two is one gesture and the filter offers both values whatever the rows on screen hold.
Encrypted reads as quiet text; the two that are not carry the warning badge with what it means.

A register opens two ways, per the table's own convention: the row's gesture (`onActivate` →
`openBeside`) and the state's name as a link, which is what buys the browser's new tab and copied
address.

## Public

**Attorney License Lookup now shows every state's register at once.** The screen used to ask you to
pick a state before it would show you anything. It is a table now — all fifty states and the
District of Columbia, the authority that keeps each register, and whether that register is served
over an encrypted connection. Choose a state's name to open its register in a new tab, or
double-click anywhere on the row.

Sort by any column, and right-click a heading to narrow by it — including **Connection**, which
brings you straight to the two states that publish their register unencrypted. The same menu turns
on an **Address** column showing each register's full web address, in case you want to copy one.
