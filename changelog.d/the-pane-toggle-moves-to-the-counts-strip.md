---
category: Changed
audience: internal
---

The control that shows and hides a side pane now ends the counts strip, on every surface that has one.

It used to sit above the table. On Time, Fees, Costs and Billing that meant a row whose only occupant, most of the time, was one glyph — 41 points taken off a table already fighting for them, spent on something that is not an act on the records at all. Those rows now render only when something has to be in them: the way out of a filter, and Costs' Review where the firm runs review. An unfiltered ledger draws no row and its table starts at the top of the screen.

The strip is not free either, and does not need to be: it grows from 32 points to 41 to seat the control. Against the row's 41, that is a net 32 points back to the table and one less band between the reader and the records.

The file manager's two toggles came down as well, though it never had the complaint — theirs ended a toolbar the screen draws anyway. They moved because the answer has to be in one place: a reader should not have to remember that it is at the top of one screen and the bottom of four others. The folder tree keeps its toggle for now.

The five details-panel toggles render through `DetailsPanel.Toggle`, which is what stops four ledgers drawing it four different ways. The folder tree's stays written out in the file manager's footer: one surface has a folder tree, and a component shared by a single caller is indirection rather than reuse. Every glyph control in that footer stepped down to the small square with them, so one band wears one chrome and the strip is four points shorter than it was.
