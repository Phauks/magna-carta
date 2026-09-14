---
category: Added
audience: public
---

**A file or a folder is filed by being dragged, everywhere the matter's file manager shows one.** A row in the list, a tile in the icon grid and a folder row in the rail are sources; a folder row in the rail, a folder row or tile in the list, and every crumb in the path including home are destinations — a crumb is how something comes back OUT of a folder, since every ancestor of where the reader is standing is already on the strip in front of them. Dragging one row of a selection carries the whole selection and the drag image says how many; dragging a row outside the selection carries that row alone.

It is ONE component rather than four copies of the same five handlers. `packages/design-system/src/lib/components/item-drag/` owns the payload, which destination is under the pointer, the mark drawn on it, the refusal and the clearing on `dragend` however the gesture ended; the surface owns only what may be dragged, what may accept it and what a drop means. The folder rail's own handlers were the first copy and were rewritten onto it rather than left as the fifth.

An upload and a move are now the same event on the same square inch, and the PAYLOAD tells them apart rather than the target: a transfer carrying `Files` came from the desktop, one carrying our own vendor media type came from a row on the page. Our own type is excluded from the file question explicitly rather than by omission, because a browser is free to add `Files` to a transfer we also wrote to.

A refusal is the pointer, not a banner — a destination that will not take the drop never prevents the event's default, so the cursor says no before the reader lets go. Four refusals, in `apps/web/src/lib/file-manager/file-drag.ts` with a test each: a destination that is not a folder, a folder into itself, a folder into its own descendant (the one that actually loses documents, by detaching the branch from the matter), and anything into the folder it already sits in. A mixed selection is not refused for its worst member — the rows that can land, land.

The drop runs `moveRows`, the path the clipboard's paste already took, so it is the same write, the same refusal and the same step on the undo stack. Cut and Paste are untouched and are not a fallback: every drag has a keyboard equivalent that already worked, which is why no second "move to folder" picker was added.

## Public

**Files and folders move by being dragged.** Pick up a row in the list, a tile in the icon view, or a folder in the left sidebar, and put it down on a folder in the sidebar, a folder in the list, or a crumb in the path above the list — which is how something comes back out of a folder, since every folder above where you are standing is already on that strip. Dropping on the home icon moves it to the top of the matter.

**Select several first and dragging any one of them carries the lot**, and what you are holding says how many.

**What cannot happen is refused before you let go.** The cursor says no over a folder that already holds the thing, over a folder being dragged into itself or into something inside it, and over anything that is not a folder. If only some of what you are holding can go where you are pointing, those are the ones that move.

**A move you made by dragging can be taken back** with the undo arrows at the bottom of the screen, exactly like one made from the menu. Dragging is the fast way and not the only way: Cut and Paste still make the same move from the right-click menu and from the keyboard. Dropping files in from your computer is a different thing and still starts an upload.
