---
category: Changed
audience: public
---

**Task comments stand beside the task.** The comment thread moved out of the task window's tabs into a column of its own on the right, so it stays in view whichever tab is open. `RecordWindow` gains an optional `aside` snippet (with `asideLabel`), a fixed column after the tabs sized by the new `size.record-aside` token; a window carrying one opens to `size.record-window-wide` (the `max-w-record-window-wide` utility), so the panel is added beside the record and its tabs rather than taken from them. Without `aside` the window renders exactly as before.

## Public

**Comments beside the task.** A task's comments now sit in their own column on the right of the task window, always in view, instead of on a tab.
