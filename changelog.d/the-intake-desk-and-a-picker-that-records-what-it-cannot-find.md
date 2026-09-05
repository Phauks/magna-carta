---
category: Added
audience: public
---

**The intake desk: the sidebar's Intake destination lists every intake in flight, starts one, and
schedules the consultation once the intake is complete.** An intake is a prospective matter, so the
desk is a reading of the firm's consultations rather than a register of its own: `readIntakeDesk`
in `@magna-carta/intake` behind `GET /api/v1/intake/consultations` (firm-wide, `intake:read`,
cursor-paged, capped at fifty because each row's standing is derived on read) joins the matters
listing to the client party, the member and matter-type names, the next scheduled event, and one
checklist read per row. The New Matter window gains an intake purpose (prospective, Start Intake,
no money block); the calendar's event window takes a seeded title and participants; the sidebar row
flips to alpha. The step-kind vocabulary gains `client-forms` and `payment` on the procedure's
own principle — a member's record ahead of the portal and the payments port — through a same-
transaction rebuild of `intake_procedure_step`. The design system's `EntityPicker` gains a
top-level New control and a per-kind add row (`onCreate` now carries the kind, and `createRefusal`
keeps the control present when the reader may not create); `directory-entity-picker.svelte` wraps
it with the Directory's own New Person and New Organization windows, seeded from what was typed,
and every surface that picks a person or an organization takes the wrapper.

## Public

**Take an intake from the phone to the calendar without leaving the desk.** Intake, in the sidebar,
lists every intake your firm has in flight — who it is for, who carries it, and how far it is
against your intake procedure. New Intake records the caller and the matter; if the caller is not
in your directory yet, the client field's New button records them there and then, and the same
button now stands beside every field where a person or an organization is chosen. Open an intake
to answer its steps, and when every required step is answered, Schedule puts the consultation on
the calendar with the client and the attorney already on it. Your intake procedures can now name
two more kinds of step: the forms the client fills in online, and a payment sent or received.
