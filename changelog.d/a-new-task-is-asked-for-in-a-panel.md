---
category: Changed
audience: public
---

**The task composer moved off the list and onto the shared action dialog.** `new-task-dialog.svelte`
carries the fields, the idempotency key and its own failure notice; `task-list.svelte` keeps only
whether the panel is open, so no part of a draft task lives on the list any more. The permission and
sample-matter refusals are now stated on the commit as well as on the create control, which is what
the matter page's header control always claimed happened once the composer was open.

The owner's ruling was already on the books for records that have a window of their own — matter
notes and the call log both came off inline composers under it. A task has no record window, and
that turned out not to matter: the rule is about where a reader learns a record's fields, so it is
now written down for a record read as a row as well.

## Public

**Adding a task opens a panel.** The form used to unfold inside the list, between the search row and
the tasks themselves, which pushed the work you were looking at down the screen while you typed. It
now opens over the list, in the same panel every other record in Magna Carta is started in, and the
list stays where it was.
