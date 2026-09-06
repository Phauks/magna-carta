---
category: Added
audience: public
---

**The matter lifecycle gains its first rung, and the intake desk stands on it.** A matter now
passes through `intake`, `consultation` (the status formerly stored as `prospective`, renamed as
spelled because no firm holds a matter yet; a reviewed rebuild of `matter` widens the CHECK), `open`
and `closed`. An intake draws no number of any kind; `graduateMatter` behind
`POST /api/v1/matters/{id}/graduate` (and its readiness read) runs the intake procedure as its gate
and draws the consultation number; `openMatter` requires a consultation and runs no intake gate;
reopen returns a matter to the rung it left. The docket excludes both unnumbered rungs. The sidebar's
Intake destination lists every intake and consultation in flight, starts one, completes it, and
schedules the consultation. The desk is a reading of the firm's matters rather than a register of its own: `readIntakeDesk`
in `@magna-carta/intake` behind `GET /api/v1/intake/consultations` (firm-wide, `intake:read`,
cursor-paged, capped at fifty because each row's standing is derived on read) joins the matters
listing to the client party, the member and matter-type names, the next scheduled event, and one
checklist read per row. The New Matter window gains an intake purpose (Intake, Start Intake,
no money block) and offers Intake among its statuses; the calendar's event window takes a seeded title and participants; the sidebar row
flips to alpha. The step-kind vocabulary gains `client-forms` and `payment` on the procedure's
own principle — a member's record ahead of the portal and the payments port — through a same-
transaction rebuild of `intake_procedure_step`. The design system's `EntityPicker` gains a
top-level New control and a per-kind add row (`onCreate` now carries the kind, and `createRefusal`
keeps the control present when the reader may not create); `directory-entity-picker.svelte` wraps
it with the Directory's own New Person and New Organization windows, seeded from what was typed,
and every surface that picks a person or an organization takes the wrapper.

## Public

**Take an intake from the phone to the calendar without leaving the desk.** Intake, in the sidebar,
lists every intake and consultation your firm has in flight — who it is for, who carries it, and
how far it is against your intake procedure. New Intake records the caller and the matter, with no
number yet; if the caller is not in your directory, the client field's New button records them there
and then, and the same button now stands beside every field where a person or an organization is
chosen. Open an intake to answer its steps; when every required step is answered, Complete Intake
makes it a consultation and gives it its consultation number; and Schedule puts the consultation on
the calendar with the client and the attorney already on it. A matter's status now reads Intake,
Consultation, Active or Closed. Your intake procedures can now name
two more kinds of step: the forms the client fills in online, and a payment sent or received.
