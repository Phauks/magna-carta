---
category: Changed
audience: public
---

**A task is read and changed in the product's one record window, and a new one is that same window
with nothing in it yet.** `task-record-window.svelte` carries the fields, the attachments tab, the
print sheet and the acts; `task-list.svelte` keeps the rows, the search, and the one act a list is
for. Everything that used to unfold inside the list is gone with it — the composer above the rows,
the row that turned into fields, the attach picker, the cancel-reason form and the per-row assignee
select — because each was a second place to learn where a task's fields live.

Two things fell out of it. `note-attachable-documents.ts` becomes
`record-attachable-documents.ts`, typed on the shape a document association has rather than on a
note's name for it: a note and a task attach a matter's files identically, and a second copy would
have been six lines free to drift. And the reason the firm is not doing a task is asked for in its
own action panel (`task-not-doing-dialog.svelte`) whose commit says "Record the Decision" — every
panel in the product leaves through a control that says Cancel, so a commit that also said it would
be two controls with one word and opposite meanings.

The owner's ruling was on the books for records that already had a window. A task had none, and the
tempting half-step — an action dialog for making one, the row still editing it — produces exactly
the defect the ruling names, with the panel and the row free to disagree about the record's own
fields. That half-step and its correction both happened here; only the second was the fix.

## Public

**Tasks open in a window, and you change them where you read them.** Press a task's own words to
open it: everything it carries is in one place, and **Edit** turns what you are reading into fields
without going anywhere else. Attaching a document, recording that the firm decided against the work,
and deleting a task are all there too. Making a new task opens the same window with nothing in it
yet. The list keeps what a list is for — seeing what is owed, and pressing **Done**.
