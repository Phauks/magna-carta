---
slice: 6·5 — Intake desk (the sidebar's Intake, the intake rung of the matter lifecycle, completing an intake into a consultation, scheduling it) and the picker that records what it cannot find
group: phase-6
order: 5
research: n/a
spec: done
plan: done
built: done
ui: done
load-profile: todo
tested: done
branch: claude/intake-workflow-development-hgn18z
active-work: docs/active-work/claude/intake-workflow-development-hgn18z.md
next: the pipeline board over firm-defined stages, if a firm needs a word the procedure cannot express; the public form, the submission and its triage, call intake; the portal reader behind client-forms and the payments reader behind payment; a per-procedure folder layout on the consultation; a load-profile volume for the desk read
link-spec: docs/specs/2026-09-05-intake-desk-design.md
link-plan: docs/specs/2026-09-05-intake-desk-design.md
adrs:
blocked-by:
---

The matter lifecycle gains its first rung and the second takes its proper name: `intake`, `consultation` (formerly stored as `prospective`; renamed as spelled by the owner's ruling, since no firm holds a matter yet, through a reviewed rebuild of `matter`), `open`, `closed`. An intake is created with no number of any kind; `graduateMatter` behind `POST /api/v1/matters/{id}/graduate` runs the firm's intake procedure as its gate and draws the consultation number; a consultation opens with no intake gate; reopen returns a matter to the rung it left; the docket excludes both unnumbered rungs. The sidebar's Intake destination ships as the desk: every intake and consultation in flight, firm-wide, with a Status column, the client, the responsible member, the practice area, where it stands against the procedure as counts ("3 of 5 answered, 1 required outstanding"), whether it has gone stale, and the next scheduled consultation or its absence. `@magna-carta/intake` gains the desk read (`GET /api/v1/intake/consultations`, behind `intake:read`, cursor-paged and capped at fifty because each row's standing is derived on read) and its precondition is renamed to the door it holds. New Intake opens the New Matter window in its intake purpose (Intake, Start Intake, no money block); a row resumes on the matter's Intake section; Complete Intake on an intake row is the graduation step, refused with the reason until every required step is answered; Schedule on a consultation row opens the calendar's own event window seeded with the client and the responsible attorney. The status window gains the Complete Intake step with Requirements To Complete Intake. The step-kind vocabulary gains `client-forms` and `payment`, a member's record ahead of the portal and the payments port. The design system's EntityPicker gains a top-level New control and a per-kind add row, and every surface that picks a person or an organization now takes the directory wrapper that opens the New Person and New Organization windows in place and hands the record back as the selection.
