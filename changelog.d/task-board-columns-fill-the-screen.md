---
category: Fixed
audience: public
---

**The task board's columns are readable widths, and a masthead's actions wrap instead of overlapping
the title.** Board columns in `task-board.svelte` were `w-64`, which on this spacing scale is 64px;
they now grow to share the width from a `min-w-3xs` floor, scroll inside the board when they cannot
fit, truncate a long status name, and say No tasks when empty. `.mc-masthead` now wraps, so on a
narrow screen the actions drop beneath the title and wrap among themselves.

## Public

**The Tasks board is readable again.** Its columns were squeezed to a sliver; they now share the
width of the screen, and a list with more statuses than fit scrolls sideways inside the board. An
empty column says No tasks. On narrower screens the buttons beside a page's title move beneath it
rather than covering it.
