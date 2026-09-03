---
category: Fixed
audience: internal
---

Two pieces of chrome every surface inherits: a full-screen panel squares its corners, and a table's totals sit on the bottom of its frame.

**A modal filling the screen has square corners.** A radius says the panel is a sheet lying on top of something; at full size there is nothing underneath it, and the curve reads as four notches of desktop showing through the corners of the application. Fixed on the shared modal frame rather than in the record window, so any shell that grows an expand gesture inherits it.

**A totals strip sits on the bottom edge of its frame, not under the last row.** A ledger fills the height it is given, so the ordinary case is a table with room beneath it — and the strip is held down by stickiness, which does nothing while there is nothing below it to scroll past. The totals of a four-row ledger were coming to rest halfway up the screen with a band of empty surface below them. The table now asks for its frame's full height and a scenery row takes the difference, so the records keep the one line each the density gives them.

Table layout does not behave the way it reads, and that row's placement was settled by measuring a real browser rather than by reasoning: in the table's foot, or as a percentage on the cell rather than the row, it is given nothing at all and the surplus is handed to the last record, which stretches to fill; with a zero-height body the records keep their height but are pushed to the bottom, putting the gap above them. As the last row of the body it takes the whole surplus and everything else stays put.

**A date field's label sits its control on the same baseline as the fields beside it.** It was omitting the line-height every other field label sets, so a date field started a few pixels below its neighbours and a row of three read as two fields and a mistake.
