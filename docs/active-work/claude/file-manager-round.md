---
worktree: /home/user/magna-carta (remote session)
area: File manager surface and undo, the inspector's rename and dialogs, and the matter status pillbox
status: active
touches: apps/web/src/lib/file-manager/, apps/web/src/lib/matters/, packages/design-system/src/lib/, docs/conventions/file-manager-rulings.md, docs/conventions/matter-rulings.md
---

The owner's 2026-09-14 round, opened the moment the previous stream's pull request merged. Three
streams run in parallel worktrees, each owning a disjoint set of files, and all three land here
before a single pull request goes up.

**The file surface** takes the defects the owner reported against the deployed screen: the left
sidebar draws a folder location differently from the four special destinations beneath it; scrolling
a long list scrolls the whole page rather than only the region holding the files; long names overlap
each other in icon view; the pin mark sits where it forces reflow instead of in a gutter to the left
of the row; and the undo and redo stacks are not properly wired. It opens `R23` in
`docs/conventions/file-manager-rulings.md`.

**The inspector and its dialogs** take the rename the owner could not perform: clicking the name in
the right sidebar opens the rename field on the row in the list instead of in the inspector, which
reads as selecting the file without being able to change it. With it go the new-folder field that
needs a click and a blur before it looks right, the row height that grows when a rename opens, and
the anti-virus result, which shows a verdict where an audit needs the detail that produced it. The
seam between the two streams is pre-settled: the inspector stops calling `onRename` and calls
`onRenameCommit(name)`, holding its own editing state, with the Magnus conversation name as the
in-place-rename precedent.

**The matter status pillbox** is a correction of a ruling this repository only just settled. It is
not a dropdown and not three buttons: it is a pillbox with one button that changes status, opening a
modal that states the requirements for the change and holds the checks that guard it. That
supersedes `L2` in `docs/conventions/matter-rulings.md`; `L1`, which added closing and holding a
matter from a consultation, still stands.

Deferred to its own round, because it collides with every file above: dragging and dropping files to
move them between folders from the main area, the sidebar and the breadcrumbs, as one shared
component.
