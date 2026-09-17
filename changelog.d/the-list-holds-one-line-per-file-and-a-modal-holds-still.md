---
category: Fixed
audience: public
---

**The file list's geometry, the scale control, and two panels that grew when they were pressed.** Six defects from the owner's round of 2026-09-16, five of them in one screen and one of them in two.

The grid reserved its row-mark slot as an inline box in every first cell. Every surface that composes a first cell out of an icon and a name composes it with flex — which is block-level — so the mark took a line of its own above the content: a band of empty space over every file name, a name reading low in a row whose other cells were still centred in a row a line taller than it should have been, and a list a third taller than the density asked for. The slot is now the cell's own leading padding with the pin painted into it (`data-table.css`), so the cell holds exactly one in-flow child whatever the surface renders there. The reservation is unchanged: a table that can mark a row still reserves the width on every row, so pinning moves nothing.

`DataTable.Grid` takes a `frame` of `card` or `flush`. A card's last row drops its hairline because the card's own bottom rule runs a hairline below it; a flush grid has no card — the file manager's toolbar and counts strip are its frame — so the rule left the last file as the one row in the list with nothing under it. Flush keeps the hairline and fills the frame. It replaces the `rounded-none border-0` incantation four file-manager grids and five money ledgers were each spelling out, which is the right trade: giving up the card changes three things that have to move together.

The scale control now scales the list. It moved one thing in list view — a single flip between two densities, at one threshold in the middle of a ten-step range — so nine of the ten steps changed nothing a reader could see. The grid reads `--mc-table-grid-scale`, a multiplier defaulting to 1, for its text, its row height and the glyphs inside its rows; the file manager publishes it once on the file area, so every view including the inside of an archive takes it. The header band and the counts strip do not scale: they are the frame around the list, and growing them pushes the rows a reader asked to see more of off the screen.

Location leaves the file list's browse columns, where a folder listing already answers "where is this" in the path above it and the tree beside it — it had to ship hidden for exactly that reason. It stands in Search Results and File Analysis, where rows come from different folders. File Type gives up the monospace face and reads in the table's own.

The Change Status panel is two sides: the steps down the left, and the step under discussion — what it does to the record, what it requires, and the field it asks for — down the right. It opens on the step the lifecycle runs toward, so `Choose a step first.` is struck along with the state that produced it.

## Public

**The file list is the height it should be, and zooming it works.** Files in list view were separated by a band of empty space, with the name sitting low in each row while every other column was centred, and the last file in a list had no line under it. The zoom control changed almost nothing in list view; it now scales the list's text, its row heights and its icons across its whole range, the same way it already scaled the icon view.

The Location column is gone from a folder's own listing, where it only ever repeated the folder you were already in. It still appears in search results and in File Analysis, where files come from different folders. File Type is no longer lettered differently from every other column.

**Changing a matter's status is now one window with the steps on the left and what each one means on the right,** rather than a list that grew a section underneath when you chose from it.

**Two controls inside the matter's status window stopped moving the window when you use them.** Recording where the paper file is kept, and setting the matter's number, are fields that stand in their rows at rest — with the office chosen from a list you can also type into — instead of buttons that opened a form underneath and pushed everything down.
