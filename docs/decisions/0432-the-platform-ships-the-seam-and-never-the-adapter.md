---
number: 432
slug: the-platform-ships-the-seam-and-never-the-adapter
status: Proposed
date: 2026-09-02
area: Tasks
summary: "Tasks carry the four primitives an outside system needs to mirror them — an external-identity table generic over an open `system` string, a deletion tombstone written in the delete's own batch, an `updated_by` stamp for echo suppression, and a change feed of two keyset streams with INDEPENDENT positions — and the platform ships no adapter, no sync engine, no conflict policy and no field mapping, because each of those is a decision about somebody else's product. The four are built now rather than when an addon is because none can be added afterwards: a correspondence kept in an addon's own side table cannot have referential integrity to matter_task or be cleaned up on delete; a hard delete is unobservable to anything not watching at that instant, and past deletions cannot be reconstructed; without updated_by a two-way sync pushes back what it just pulled; and a feed retrofitted onto a table with no ordered cursor cannot report the changes that happened before it existed. Both uniqueness rules on the link table are INDEXES rather than service checks, because the failure they prevent — two tasks fighting over one mirror — is produced by exactly the race a pre-check loses. The feed's two streams carry separate positions because one shared cursor drops rows silently: its id half comes from whichever stream produced the last row, and a deletion handle used as the tie-break against matter_task.id excludes every live task sorting below it at that instant, permanently. Visibility is never relaxed for a sync: the feed composes the same predicate every other task read does, so an addon connected as a member syncs exactly what that member can see."
---

**Build the seam, not the integration — and build it now, because none of it can be retrofitted.**

**Context:** the owner intends to build an addon that mirrors tasks to and from ClickUp. The obvious
readings of that request are both wrong. Building the ClickUp adapter now would be machinery with no
consumer, guessing at a vendor's semantics, and it would put a vendor's name in the schema. Building
nothing and saying "the REST API is already there" would also be wrong: the API can create and edit
tasks, and an addon built on that alone would be structurally unable to do its job.

Four things are missing, and the reason they are worth building before the addon exists is that each
one is impossible to add correctly later.

- **A correspondence.** Nowhere records that a task IS ClickUp task `86xy2`. An addon keeping its own
  side table has no referential integrity to `matter_task` and no way to be cleaned up when a task is
  deleted, so its mapping rots silently.
- **An observable deletion.** A task hard-deletes, which is right for a record that should not exist
  and makes the deletion invisible to anything that was not watching at that moment. Past deletions
  cannot be reconstructed from anything.
- **Write provenance.** Without knowing who touched a task last, a two-way sync cannot tell its own
  writes from a person's, so it pushes back everything it just pulled and the two sides oscillate.
- **An ordered change feed.** The outbox is a dispatch queue that consumes its rows; nothing can
  answer "what changed since I last looked". Retrofitting a cursor cannot report the changes that
  happened before it existed.

**Decision:** four primitives, generic, and no adapter.

- **`matter_task_external_link`.** `system` is open text with a non-empty CHECK, on the
  `directory_edge.edge_type` precedent, so a second system is an addon rather than a reviewed
  migration and no vendor is named anywhere in the schema. The external id is opaque: never parsed,
  never ordered by, never assumed to have a shape. `remote_revision` holds whatever the vendor
  considers a version — an ETag, a millisecond stamp — stored and handed back, never compared.
- **Both uniqueness rules are INDEXES, not service checks.** One remote object maps to at most one
  task; one task holds at most one identity per system. The service pre-checks so the common case is
  a readable refusal, and that pre-check is explicitly not the enforcement — the failure being
  prevented (two tasks fighting over one mirror, each winning half the time) is produced by exactly
  the concurrent case a pre-check loses.
- **`matter_task_deletion`, in the delete's own batch.** Identifiers and nothing else: a tombstone
  preserving the title would defeat the delete it records. `task_id` is deliberately not a foreign
  key, because the row it names is gone. The task's external links are dropped in the same batch, so
  the remote object's uniqueness slot is freed and can be linked to a real task again.
- **`matter_task.updated_by`, stamped by every write path**, including the cascade that clears a
  successor's blocker — that successor really did change, and a mirror that missed it would show work
  blocked by something that no longer exists. Required rather than optional in the statement
  signatures, so the compiler named all six call sites rather than leaving one silently unstamped.

**The change feed carries two positions, and that is the subtle part.** The feed merges tasks that
moved with tasks that were deleted. Both are ordered on the same time axis, so one cursor looks
sufficient. It is not: the cursor's id half comes from whichever stream produced the last row, and
applying a `matterTaskDeletion_` handle as the tie-break against `matter_task.id` excludes every live
task whose handle sorts lower at that same instant. Those tasks are then never reported again,
because the next page starts after them. The failure is a change lost permanently, at a page
boundary, under a clock collision that cannot be reproduced on demand — so each stream carries its
own `(instant, id)` position and neither can move the other past anything.

**Visibility is never relaxed for a sync.** The feed composes `taskVisibilityFragment` like every
other task read: an addon connected as a member syncs exactly what that member can see, and there is
no privileged enumeration. The external-id lookup returns the same null for "no such correspondence"
and "you cannot see the task it names", so it cannot be used to probe for tasks on matters the caller
has no reach into.

**Consequences.** What the platform deliberately does not decide: how a remote's many statuses map
onto three states, how a conflicting edit on both sides resolves, how often a sync runs, what an
addon does with a field this product does not model. Those belong to the adapter, on
`@magna-carta/integrations`, whose ports-and-adapters framework already carries the credential and
capability machinery. The vocabulary does not bend to fit a remote's — firm-defined statuses remain
owner flag **T3** — and an adapter must not invent them by writing free text somewhere. The contract
an adapter author is held to is written in `packages/tasks/CLAUDE.md` rather than in a spec, because
that is where somebody building one will look.
