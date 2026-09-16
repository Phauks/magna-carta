---
category: Fixed
audience: public
---

**The file manager's rename field opens with the cursor in it, and does not move the row.** Three
defects with one field between them. The list's in-place field was never focused and never
selected, so making a folder put a name field on screen that nobody was typing in — the reader had
to find it, click it and click away again before it looked right; `beginRename` now focuses it and
selects the stem, the same gesture `file-inspector.svelte` already made for the panel's own field.
The field also pushed its row taller, which is arithmetic rather than styling: `.mc-table-cell` in a
grid is `block-size: var(--mc-control-sm)` with `padding-block: var(--mc-space-4)`, and `.mc-input-sm`
asks for that same full control height, so it could not fit in the box it was in. It gives up the
control's own minimum and takes the cell's content box. A refusal still grows the row, because the
reason has to be readable.

**A table's row mark keeps its space whether or not the row is marked.** `data-table-grid.svelte`
drew the pin in the first cell only while the row was pinned, so pinning shifted that cell's text by
the glyph and its gap — the reader saw the list twitch at the moment they acted on it. Any grid
given a `rowMark` now keeps the slot on every row; a grid that never marks a row reserves nothing.
The condition is the capability, not the current state, because a condition that changes when the
first row is pinned reflows at exactly the moment the reflow would be seen.

**One rename path, two places to say no.** `renameTo` answers with the sentence that refuses rather
than posting it itself, so the list's field sends a refusal to the screen's failure band while the
details panel keeps its own field open with the reason beneath it. The two halves of that seam were
built in parallel and disagreed about the answer's type; the panel's half is the one that was right.

## Public

**Naming a new folder no longer takes three clicks.** Make a folder and the cursor is already in its
name, with the stand-in name selected, so you can type over it. Renaming from the list works the
same way, and the row no longer grows taller while the field is open.

**Pinning a document no longer nudges the list.** The space for the pin is always there, so pinning
lights the mark and moves nothing.
