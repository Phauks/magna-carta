---
worktree: C:/dev/magna-carta-worktrees/claude/wizardly-pasteur-ksiaxq
area: Tasks — a new task is asked for in the one action panel rather than in a form that unfolds inside the list
status: building
touches: apps/web/src/lib/matters, docs/conventions/design-corrections.md, changelog.d
---

The task composer was a block that opened between the control row and the rows it would join, so a
task was the one record in the product made in a place a reader had to learn twice. It moves to the
shared ActionDialog as `new-task-dialog.svelte`, which is where every other create in the product is
asked for. The list keeps the rest of its shape, and the row-level edit is untouched.
