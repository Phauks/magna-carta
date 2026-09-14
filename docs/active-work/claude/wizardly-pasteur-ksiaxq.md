---
worktree: C:/dev/magna-carta-worktrees/claude/wizardly-pasteur-ksiaxq
area: Tasks — one record window reads, changes and makes a task; nothing unfolds inside the list any more
status: review
touches: apps/web/src/lib/matters, apps/web/test, docs/conventions/design-corrections.md, docs/user/features/tasks.md, changelog.d
---

The task surface had a composer that opened above the rows and a row that turned into fields, so a
task was read in one place and changed in another. It moves to the product's one record window
(`task-record-window.svelte`), which reads a task, edits it in place, and opens empty-with-fields for
a new one; the attach picker and the cancel-reason form go with it, into the window's Attachments tab
and its own action panel. `note-attachable-documents.ts` is now `record-attachable-documents.ts`,
shared by the note window and this one — the notes surface is touched only by that rename.
