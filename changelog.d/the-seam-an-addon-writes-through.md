---
category: Added
audience: public
---

**Tasks gain the four things an outside system needs and none of the things a vendor does.**

The platform still integrates with nothing. It ships no adapter, schedules no sync, resolves no
conflict and maps no vocabulary — every one of those is a decision about somebody else's product and
belongs to the addon that knows it, on `@magna-carta/integrations` where the credential and
capability machinery already lives. What ships is the part the platform cannot delegate, and each
piece is here because it is impossible to add afterwards:

`matter_task_external_link` records that a task IS some object over there. `system` is open text with
a non-empty CHECK — the `directory_edge.edge_type` discipline — so a second system is an addon
rather than a reviewed migration, and nothing in the schema names a vendor. **Two uniqueness rules,
and they are different claims:** one remote object maps to at most one task, or two tasks fight over
one mirror and each wins half the time; one task holds at most one identity per system, or a change
here has two places to go and no way to choose. Both are INDEXES rather than service checks, because
a race between two syncs is exactly the case a pre-check loses — a test composes two colliding links
before committing either and asserts the loser aborts.

`matter_task_deletion` is the tombstone, written in the **same batch** as the delete. A row that is
gone cannot be enumerated afterwards, so a mirror learns of a deletion there or never, and one that
never learns keeps the work alive somewhere the firm has stopped looking. It carries identifiers and
nothing else: a tombstone preserving the title would defeat the delete it records. A deleted task's
external links go with it, so its remote object is free to be linked to a real task again.

`matter_task.updated_by` is echo suppression. A two-way sync must tell its own writes from a
person's, or it pushes back everything it just pulled and the two sides oscillate. Every write path
stamps it — including the cascade that clears a successor's blocker, because that successor really
did change. It is required rather than optional in the statement signatures, which is what made the
compiler name all six call sites.

`readTaskChanges` answers "what moved since I last looked" as two keyset streams with
**INDEPENDENT POSITIONS**. One shared cursor looks sufficient and is wrong in a way that would never
surface in testing: the cursor's id half comes from whichever stream produced the last row, and a
`matterTaskDeletion_` handle applied as the tie-break against `matter_task.id` silently excludes
every live task sorting below it at that same instant — a change lost permanently, at a page
boundary, under a clock collision nobody can reproduce on demand. A test walks five tasks written at
one instant a page at a time and asserts nothing is skipped or repeated.

Visibility is not relaxed for any of it. The feed composes `taskVisibilityFragment` like every other
task read, so an addon connected as a member syncs exactly what that member can see, and the
external-id lookup returns the same null for "no such correspondence" and "you cannot see the task it
names" so it cannot be used to probe.

Five routes, the external links folded into the page read beside the attachments and the time, and
the adapter-author contract written where an adapter author will look: `packages/tasks/CLAUDE.md`.

## Public

Tasks are now ready to be connected to another tool.

Magna Carta does not connect to ClickUp, Asana or anything else on its own, and nothing in the
product will offer to. What it now has is the groundwork an **add-on** needs, so one can be built
without changing how tasks work.

A task can carry its identity in another system, and when it does, the task's row says so and links
straight to it. A task can be mirrored into more than one tool at once. Editing on either side is
possible, and the record keeps enough to stop the two copies fighting — including who changed a task
last, so an add-on can tell its own updates from a person's.

Deleting a task is handled properly rather than quietly: the record keeps a note that it existed and
was deleted, so a connected tool learns the work is gone instead of leaving it on somebody's board
forever.

An add-on only ever sees what the person it is connected as can see. Connecting one does not open a
side door to matters that person has no access to.
