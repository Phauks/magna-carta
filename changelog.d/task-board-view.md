---
category: Added
audience: public
---

**Tasks as a board.** `task-board.svelte` draws the task list one list at a time, a column per status in the list's order, behind a List and Board switch in `task-list.svelte`; the board reads its list whole through `listIds`. Cards move through `ItemDrag`, and only the statuses `statusesReachableFrom` returns for the carried card accept it, so a move the flow refuses is never attempted. Mark Complete is a drop zone after the last column and leaves the status where it stood. A card opens the same task window and a move is the same status write the row's pill makes.

## Public

**Tasks can be shown as a board.** Choose **Board** at the top of the Tasks list to see one list's tasks as cards in a column for each status. Drag a card to move it along, or onto **Mark Complete** to finish it. While you carry a card, the columns it cannot move to next fade, so you can see where it can go.
