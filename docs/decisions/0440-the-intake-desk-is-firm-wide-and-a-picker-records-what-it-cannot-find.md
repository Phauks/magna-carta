---
number: 440
slug: the-intake-desk-is-firm-wide-and-a-picker-records-what-it-cannot-find
status: Accepted
date: 2026-09-05
area: Client intake
summary: "The intake desk is a firm-wide reading of the firm's intakes and consultations — never a register of its own — and an intake is complete when no required step of the procedure binding its kind is outstanding, which is when the consultation may be scheduled from it. Every intake is resumed on its matter's own Intake section. And a field that picks a person or an organization can RECORD one from where it stands: the design system's picker offers a top-level New and a per-kind add row, and the application wraps it with the Directory's own New Person and New Organization windows so a record made from a client field is the same record, past the same duplicate gate, as one made from the Directory."
---

**An intake in flight is a matter in the intake status, the desk is every one of them, and a person can be
recorded from wherever they are chosen.**

**Context:** the owner's direction of 2026-09-05 described the receptionist's workflow — open
Intake from the sidebar, choose the caller from the directory or create them, collect what the
intake requires, clear the conflicts check and the agreement and the forms and the payment,
resume any of several intakes, and schedule the consultation once the intake is complete — and
asked for a top-level New on the client field and every other place a person is chosen. The 2026-
08-15 design had left the pipeline's visibility open (flag J4) because ADR-0080 had made the
Consultations view deliberately per-attorney, and the picker could add a record only through a row
that appeared after a failed search.

**Decision:** the desk reads the firm's intakes and consultations through the matters listing's own
statement, firm-wide behind `intake:read`, and adds no table; a consultation leaves it by opening
or closing. "Complete" is the procedure's own count of outstanding required steps, the same number
the opening gate refuses on, and the desk prints counts and never a word about the client. The
consultation is scheduled from the desk through the calendar's own event window, seeded with the
client and the responsible attorney, and refused with the reason while a required step is
outstanding. Two step kinds, `client-forms` and `payment`, are added ahead of the subsystems that
will answer them. The picker's New is top-level — present before anything is typed — and the
application's wrapper opens the Directory's own windows, seeded from what was typed, and hands the
record back as the selection with its name read from the directory.

**Considered and rejected:** a per-attorney desk on the Consultations view's model, because the
people who work one intake hold different seats and each has to find it; an `intake` table or a
stage column to mark an intake as complete, because the checklist is derived and a stored
completeness would be free to disagree with it; scheduling the consultation from an intake still
short of its required steps, because the owner's workflow orders the two and the firm's procedure
decides what is required; a lighter New Person form inside the picker, because a second form is a
second place to learn where a person's fields live and a second duplicate gate to keep in step; and
an add row alone, because a way to add a record that only appears after a failed search is found by
accident.

**Consequences:** the sidebar's Intake row ships; the Consultations view is unchanged; a firm's
procedure can name the client's forms and the payment; every picker over the directory can record
into it under `directory:edit`, and the design system's picker states the refusal when the reader
may not. Spec:
[`docs/specs/2026-09-05-intake-desk-design.md`](../../specs/2026-09-05-intake-desk-design.md).
