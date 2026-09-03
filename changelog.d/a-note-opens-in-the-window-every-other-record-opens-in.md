---
category: Changed
audience: public
---

Matter notes: a note is written, read, changed and deleted in the shared record window, its date and time sit on one line, and a document can be attached before the note exists.

The owner's first review round on the section, and one report that did not reproduce.

**The composer is gone; the record window took its place.** Writing a note was a form that unfolded inside the list it would join — a second place to learn where a note's fields live, and a list that lost its own shape while somebody was typing. A note now opens in the same two-pane window a time entry and a cost open in: the record on the left, its Attachments tab on the right, one action bar underneath. Creating one is that window with nothing in it and its fields already open, which is what makes starting a note a modal act rather than an inline one. The primary action reads **New Note**, the occurrence field is labelled **Date** with **Time** beside it on the same line, and the shared window brings a printable sheet with it — a note states both of the times it carries, so a reader years later can see how long after the call it was written down.

**A document is attached while the note is still a draft.** The picker offers the matter's own files from the first keystroke; the choices are held in the window and written the moment the note is. Nothing is uploaded and nothing is copied, exactly as before. Where a note is written but one of its documents does not attach, the list says which one and why rather than reporting a failure to save — the note exists, and somebody told otherwise would write it twice. Notes have no upload path of their own, so the shared attachments tab now withholds its dropzone from any record that cannot take one, rather than rendering a control that swallows a file in silence.

**On the report that the section never stopped loading:** it did not reproduce. The section was driven end to end against a real Worker — an empty matter, a matter with notes, a note written through the window, a document attached before saving — and the list settled every time; so does the route's empty-page envelope, now pinned by its own tests. What the rebuild changed is the shape that made a permanent skeleton possible at all. The notes read is an effect of its own, so nothing else the screen wants (who is signed in, the roster, the matter's files) can abort it before the read is even asked for, and a failed read settles the list with a stated reason and a Retry instead of leaving the skeleton standing. A section sitting on a skeleton is indistinguishable from a firm whose record cannot be read, which is why that is now structurally unreachable rather than merely unobserved.

Two things found on the way. A size utility off the generated spacing scale (`w-160`, `w-192`) compiles to no rule at all and no gate says so, which had left a search field and a date field full-bleed where both were meant to be narrow; the trap is recorded in the UI conventions. And `apps/web/e2e/login.spec.ts` no longer matches the shipped sign-in screen — the suite is not wired into CI, so it rotted unnoticed, and one of its assertions now contradicts shipped behaviour rather than merely naming a stale selector.

## Public

**Notes open in the same window as everything else.** A note is written, read, changed and deleted in the record window you already know from time and costs, and clicking a note in the list opens it there. Starting one is **New Note**.

**Say when it happened, on one line.** The date the thing happened and the time on that date sit side by side. Leave them empty for a note that describes no single moment.

**Attach a document while you are still writing.** Pick from the matter's files as you write; the documents are attached when you save the note. The document is not copied or moved — it stays in the matter's files, exactly as before.

**Print a note.** A note's sheet states both times it carries — when the thing happened and when it was written — along with who wrote it, who last changed it, and every document attached.
