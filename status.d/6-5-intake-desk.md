---
slice: 6·5 — Intake desk (the sidebar's Intake, every intake in flight, starting one, scheduling the consultation) and the picker that records what it cannot find
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

The sidebar's Intake destination ships as the desk: every consultation the firm has in flight, firm-wide, with the client, the responsible member, the practice area, where it stands against the procedure binding its kind as counts ("3 of 5 answered, 1 required outstanding"), whether it has gone stale, and the next scheduled consultation or its absence. `@magna-carta/intake` gains the desk read (`GET /api/v1/intake/consultations`, behind `intake:read`, cursor-paged and capped at fifty because each row's standing is derived on read). New Intake opens the New Matter window in its intake purpose (prospective, Start Intake, no money block); a row resumes on the matter's Intake section; Schedule opens the calendar's own event window on the consultation, seeded with the client and the responsible attorney, and is refused with the reason until every required step is answered. The step-kind vocabulary gains `client-forms` and `payment`, a member's record ahead of the portal and the payments port, through a per-firm table rebuild. The design system's EntityPicker gains a top-level New control and a per-kind add row, and every surface that picks a person or an organization now takes the directory wrapper that opens the New Person and New Organization windows in place and hands the record back as the selection.
