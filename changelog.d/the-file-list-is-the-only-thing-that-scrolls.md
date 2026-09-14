---
category: Fixed
audience: public
---

**The matter's file list is the only part of that screen that scrolls, and undo reaches the acts a reader performs on it.** Five corrections to the file manager, from the owner's walk of the deployed screen.

Scrolling a long folder used to scroll the whole page: the matter's title, its row of sections and the folder path all left the top of the screen while the counts strip walked off the bottom. The cause was one utility and it reached every working surface in the product. A screen of this shape renders inside a column whose height is a minimum over an auto height — deliberately, so an ordinary document section can still grow past the fold — and the section inside it asked for its share with `flex-1`, whose zero basis is a PERCENTAGE. Against a column sized by its content that resolves to the item's own content, so the section reported the whole table as its base size, the column grew to meet it, the minimum never applied, and nothing was ever capped. A definite basis gives the column its minimum back. The four money ledgers take the same fix.

Undo and redo were wired to one act out of five. A move between folders was recorded; renaming, deleting and pinning were not, so the controls sat disabled through most of a session and read as broken — the stack and the pair of controls were never the defect. Each of those acts now records a step with a real inverse, and each says what it will take back ("Undo renaming Motion.pdf to Answer.pdf"). A move records only what actually moved, which it did not before: an origin written before the write meant a refused move still landed on the stack, and undo would have offered to put back something that never left. Deleting a folder has no restore behind it, so it records nothing and the screen says so instead, naming Deleted Files, where the documents it held can still be recovered one by one.

In the left rail, a chosen folder and a chosen view now look like one state rather than two. The view rows wore the ordinary selected surface, which on that sunken rail is very nearly the rail's own colour, so the open view read as barely marked beside a folder that was plainly lit.

In the icon layout, a long file name used to run over the tiles beside it and both became unreadable. A name now wraps onto a second and a third line and then ends in an ellipsis, with the whole name on the tile's hover; the pin's space is held open on every tile, so pinning lights a glyph and moves nothing.

The details panel's rename commits through the panel now and runs the list's own path — the same collision check, the same write, the same undo step.

## Public

**Scrolling a long folder on a matter's Files page now scrolls the list and nothing else.** The matter's title, its row of sections, the folder path and the counts strip along the bottom stay where they are however many documents are in the folder, so the screen reads as one screen at any length. The same fix reaches the four money sections, which are built the same way.

**Undo and redo cover the acts you actually perform on that screen.** Renaming, moving something between folders, pasting what you cut, deleting a file and pinning can each be taken back from the arrows at the bottom, and each one says which change it will reverse before you press it. Deleting a **folder** still cannot be undone: the screen says so at the time and points you at Deleted Files, where the documents that folder held can be brought back one at a time.

**In the left rail, the folder or view you are standing in is lit the same way whichever it is.** History, Deleted Files, Search Results and File Analysis were marked so faintly against the rail that the open one was hard to pick out beside a chosen folder.

**In the icon layout, a long file name no longer runs over the tiles beside it.** A name wraps onto a second and a third line and then ends in an ellipsis, and the whole name is there on the tile's hover. Pinning an item lights a pin without shifting anything around it.

**A document can be renamed from the details panel itself**, with the same refusal you get on a row when the name is already taken in that folder.
