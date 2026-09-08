---
category: Fixed
audience: public
---

**The file manager's folder path no longer moves the toolbar, and Home is always in reach.** Opening
a folder deep enough for the path to outrun its strip used to put a horizontal scrollbar under it,
and the scrollbar took its own height out of the toolbar: every control on the row shifted the moment
a reader went deep, and shifted back when they came up. The path also carried Home at its head, which
made it the first thing to scroll off the left — the one crumb always worth reaching.

Home is pinned beside back, forward and up now, outside the part that scrolls. A path deeper than its
room folds its middle behind an ellipsis, keeping the folder under Home and the last two, and
pressing the ellipsis opens the folded folders as a menu: one press to any of them. What still does
not fit scrolls, with the scrollbar hidden and the gilt edge rule drawn in its place, so the toolbar
is the same height at every depth; the strip holds itself at its far end, so the folder the reader is
standing in is never the crumb that scrolled out of sight.

The fold itself is the design system's one collapse rule (`collapseBreadcrumb`), shared with the
`Breadcrumb` component, so the two surfaces that draw a path cannot fold it differently. Hiding a
scrollbar is now the shared `mc-scrollbar-hidden` recipe, which the sidebar's nav list had written
out for itself.

## Public

**The path above a matter's files stays put, and Home is always one press away.** Opening a folder
deep in a matter used to shift the whole row of controls above the list as a scrollbar appeared under
the path, and shift it back on the way out; Home, at the head of the path, was the first thing to
slide out of reach.

Home now sits beside the back, forward and up buttons, where it stays whatever folder you are in. A
path too long for its strip folds its middle away behind an ellipsis: the folder you are in, the one
it sits in, and the first folder under Home stay visible, and pressing the ellipsis lists the folders
it stands for so you can open any of them directly.
