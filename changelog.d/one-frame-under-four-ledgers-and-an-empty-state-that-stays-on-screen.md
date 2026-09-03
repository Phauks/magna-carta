---
category: Changed
audience: internal
---

The four financial ledgers — Time, Fees, Costs and Billing — now hold their chrome in common, and an empty table centres in what the reader can see.

**They take the screen and keep it.** Each ledger capped its table at the viewport height and then grew past it, so the counts footer walked off the bottom as entries arrived. They now sit in one `FullHeightSection`, the frame the file manager already used: the table scrolls inside itself, the footer stays on the bottom edge, and a page never reflows because a row landed. The panes below it are one `LedgerPanes` component rather than four copies of the same geometry — a difference between two of these tables was already a defect by the one-table ruling, and the frame around the table is the same argument one level out.

**The empty state stops running off the right.** A placeholder row spans every column, so its cell is as wide as the TABLE — wider than the frame whenever the columns are, and far wider once anybody has widened one. Centred in that cell, the empty state's watermark and heading landed off past the inline end with the sentence trailing after them: measured in a 660-pixel frame, the heading sat entirely past its right edge, centred at 691 where the frame ended at 680. The grid now measures its own visible width and the placeholder's content sits in a block stuck to the frame's leading edge and sized to it, so the state centres in the visible width and holds its place when the table is scrolled sideways. Two rules had to be beaten for that to land, and both were found by measurement rather than by eye: the cell's own inline padding, and the transparent border every row's first cell reserves for the selection rail — two pixels of silent offset on a row that is not a row and is never selected.

**One pane toggle, the file manager's.** All four wore a bordered secondary button; they now wear the same quiet chrome affordance the file manager does, last in the row on every ledger. The divider between the panes loses its centred grip handle — resizing is unchanged, and the whole edge always dragged.

**The Time tab drops its Time Sheet button.** The sheet opens from the top bar on every screen including this one, so a second door here took a reader somewhere they were already standing. Its handle in the top bar also loses the border that made it read as a different kind of control from the download tray and the bell beside it.

**The Fees toolbar is one row.** View, Amend, New Fee and the pane toggle sat across two lines with the arrangement's facts; they are now one row, and the second line is back.
