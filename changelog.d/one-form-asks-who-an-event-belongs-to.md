---
category: Changed
audience: public
---

**There is one record form for an event, and its first question is who the event belongs to.** `record-firm-event-dialog.svelte` is deleted; `record-event-dialog.svelte` is the only one.

Two forms meant a reader had to know, before opening anything, whether the thing they were about to record was firm business — and had to close one panel and open the other on finding out they had guessed wrong. They asked nearly the same questions in nearly the same order and drifted anyway (owner, 2026-09-16: "firm events and events should be the exact same").

**Two choices and no third** (owner ruling). Matter writes a `matter_event`; Firm writes a `firm_event`. There is no None, because there is no third table for one to land in, and inventing a third word for the same row would put two records on the calendar that nothing could tell apart afterwards. A personal appointment is a firm event with only the one person on it, which is what the `participants` audience already means.

**What the choice reveals is only what genuinely differs.** Matter reveals the matter picker beside it, on the same line — "a matter" and _which_ matter are one answer given in two presses. Firm reveals the audience (everyone at the firm, or the people listed) and the office, which is a real foreign key on a firm event because it is what says which rooms are nearby; and it hides the court reference, which a firm meeting has no court for. An all-members firm event hides the participant list too, because that list is one the record ignores.

The `Record` menu offers two kinds rather than three. A third item would be a second way to open one panel, and the reader would still have to decide before opening anything — which is the thing that was wrong.

This supersedes the 2026-09-14 arrangement, where leaving the matter picker empty was what made the record a firm event. That was the right shape for the data and the wrong shape for the reader: an absence answered a question nobody had been asked.

## Public

**Recording an event is one form now, and it asks what the event is for.** There used to be two — New Event and New Firm Event — so you had to decide which kind of thing you were recording before you had opened anything, and start again if you chose wrong. Now there is one **New Event**, and the first line asks whether it belongs to **a matter** or **the firm**.

Choose **a matter** and the matter picker appears beside it. Choose **the firm** and you are asked the two things only a firm event needs: who sees it — everyone at the firm, or just the people you list — and which office it is at, which is what tells the form which conference rooms are nearby. The court reference field disappears, because a firm meeting has no court.

Everything else is the same questions in the same order either way, which is what the two forms had stopped being.

---

**A date field inside a `FieldRow` needs a wrapper, and two of them did not have one.** A labelled `DatePicker` renders TWO SIBLINGS — the primitive's Root is a context provider with no DOM of its own, so the label and the segmented field come out side by side with nothing around them. `FieldRow` is `grid sm:grid-cols-2`. Unwrapped, "Starts" took the first column, the date field took the second, and Time wrapped onto a line of its own: the row `record-timing-fields.svelte` exists to keep straight was three cells in two columns (owner, 2026-09-16: "start time and end time fields look wierd"). The 2026-09-14 move onto `FieldRow` is what introduced it.

Both date fields are wrapped now, and so is the Repeats end date, which had just been written into the same trap. The gap is 4 rather than 8 because the date label carries its own 4 of margin, so 4 + 4 is the 8 the Time group beside it uses and the two labels sit the same distance above their controls.

The design system's own notes document this trap and name the thirteen consumers that wrap for it; it stays a quiet one because the label's margin makes the spacing look right in a flex column, where it is right.
