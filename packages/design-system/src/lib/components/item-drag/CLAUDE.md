# The drag family — CLAUDE.md

One drag gesture, and how a surface tells an internal drag from a file upload. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The drag family: one gesture, and one question that tells it from an upload

`item-drag/` (`ItemDrag`, `carriesDraggedItems`, `carriesExternalFiles`) is the whole of dragging
one of OUR items somewhere else. It is registered in `lint:one-ui`, so a second set of drag
handlers is a defect rather than a choice.

- **Why it is a component and not a helper.** It ships a recipe of its own (the mark and the
  drag-image count), and a module with a stylesheet is a component wearing a different name.
- **The payload is a vendor media type, and it is the ONLY way a surface knows whose drag this is.**
  The same `dragover` reaches a folder row whether the pointer holds a file from the desktop or a
  row being filed; deciding by target treats one as the other the first time they overlap. Ask
  `carriesExternalFiles` / `carriesDraggedItems`, never `dataTransfer.types` directly. `Dropzone`
  declines a drag it can positively identify as ours, and the File Workbench's drop target asks the
  same question.
- **A refusal is the pointer.** A drop that cannot land is refused by NOT preventing the default, so
  the cursor says no before the reader lets go. Never a message after the fact.
- **A row is lifted into being draggable for the press it is under**, on `pointerdown`, and given
  its own behaviour back on `pointerup` or `dragend`. A table whose every row carries `draggable`
  permanently loses text selection on every surface that uses it, so this is deliberately NOT a
  `rowsDraggable` prop on `DataTable.Grid`. Markup that already declares `draggable` is left alone.
- **`FolderTree` takes `drag` and `dragKeyOf`** so a surface with several drop targets hands the
  rail ITS drag rather than running a second one; given neither, it builds its own over
  `onMoveFolder`, which is what the folder picker and the stories use.
