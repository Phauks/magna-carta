---
category: Added
audience: public
---

**An add line at the foot of every task-list band, and a task's repeat in its own panel.**
`DataTable.Grid` gains `bandFoot`, a line drawn under each band's last row that opens into one cell
per column; the task list uses it so Enter adds a task, and `presetsForBand` (`task-columns.ts`)
starts the task in that band's list, status, assignee, matter or due day. A task's repeat is made,
changed and stopped only in `task-repeat-dialog.svelte`; the task window shows the rule as a
sentence with Change Repeat.

## Public

**Add a task straight from the Tasks list, and set a repeat in its own window.** Every group in the
Tasks list now ends in an Add a task line: type what to do and press Enter, and the task lands in
that group, on its list, status, person, matter or day, with the line left open for the next one.
Making a task repeat now opens a window of its own, and once a task repeats it shows the rule as a
sentence with a Change Repeat button, so the series cannot be changed by a stray click.
