---
number: 456
slug: a-consultation-can-be-held-or-declined-and-a-release-returns-where-the-hold-found-it
status: Proposed
date: 2026-09-11
area: Matters
summary: "The hold and close edges of the matter lifecycle extend to a consultation: a firm parks a consultation it has not decided on, or declines one, from the consultation itself. The hold accepts `open` or `consultation` (an intake is still refused: it has nothing yet to pause), and its release returns the matter to WHERE THE HOLD FOUND IT rather than to `open`, reading `opened_at` as the one honest signal — the same signal the reopen already reads — so a parked consultation never becomes an active matter by being released. The close already accepted a consultation at the service and keeps doing so: the same preconditions run, a consultation with nothing on its ledgers passes them, and it keeps its tentative number and draws no matter number, so the firm's matter run stays dense. The refusal code for a hold on the wrong rung keeps its name (`matter-not-open`) because callers branch on it. On the screen, the status seal becomes a dropdown of the steps the lifecycle allows from where the matter stands — never a picker of statuses — with the status window as its last item; each step declares whether it is taken in the window (it needs input or has requirements worth reading) or from its own confirmation."
---

**A consultation the firm has not decided on is a file it has to be able to park, and one it has
decided against is a file it has to be able to close.**

**Context:** The lifecycle stored `intake -> consultation -> open <-> hold -> closed`, and the
consultation rung had one edge out: opening. The hold route refused anything but an open matter,
on the reasoning that a hold pauses work and only an active matter has work to pause. The close
service accepted a consultation (a declined consultation was a tested case), but the screen never
offered it: `MATTER_LIFECYCLE_STEPS.consultation` was Open Matter alone. So a firm that took a
consultation and then heard nothing for a month, or decided not to act, had two wrong answers —
open the matter, which draws a permanent number for a file that does not exist, or leave the
consultation standing as if it were live. The owner's ruling (2026-09-11) is that the consultation
itself has to be able to say either.

**Decision:** Two edges are added at the contract, and the release changes what it restores.

- **The hold accepts a consultation.** `holdMatter` and `holdMatterStatement`'s in-batch guard take
  `open` or `consultation`. An intake is still refused: it is the walk toward a consultation, not
  yet a file the firm has taken, and putting it on hold would record a pause of nothing.
- **A release returns the matter to where the hold found it.** `releaseMatter` reads `opened_at`
  — stamped when a matter opens and never before — and restores `open` where it is set and
  `consultation` where it is not. The statement takes the status to restore rather than assuming
  `open`. This is the same signal `reopenMatter` already reads to restore a consultation, so the
  two restorations cannot disagree. A parked consultation therefore never becomes an active matter
  by being released; only opening draws a number.
- **The close stays as it was, and is now offered.** No service change: the same preconditions
  run, a consultation with nothing on its ledgers passes them, the tentative number stays and no
  matter number is drawn. The screen offers it from the consultation's seal as Close Consultation.
- **The refusal code keeps its name.** A hold on the wrong rung still raises `matter-not-open`,
  because callers branch on the code and a rename buys only churn; the message names both statuses
  the hold takes.
- **The seal is a dropdown of steps, and the "steps, never a picker" rule is amended to say why
  that is still not a picker.** The menu lists what can be DONE from where the matter stands,
  never the five statuses; a status list would offer states the lifecycle may not reach from here
  and would have nowhere to ask for the hold's reason or show what closing requires. Each step
  declares how it is taken from the seal: a step needing input or carrying requirements opens the
  status window at the step; a step needing nothing asks its one question and runs. The window
  stays as the menu's last item, because it is where the number, the engagement and the paper
  file live.

**Alternatives considered:**

- _A hold on an intake as well._ Rejected for now: an intake has nothing to pause, and its own
  procedure already models "not yet answered". Nothing in the change forbids it later; the guard is
  one set membership.
- _A release that always restores `open`, with the consultation case left to the reopen._ Rejected:
  it makes releasing a parked consultation a way to open a matter without drawing a number, which
  breaks the invariant that a matter number is drawn the moment a matter opens and never before.
- _A picker of statuses on the seal, with the server refusing the illegal ones._ Rejected: it is
  the picker the standing rule refuses, and it has no place to ask for the reason a hold must carry.

**Consequences:** A held matter on the docket may now be one that was never numbered, so any
surface that inferred "held means numbered" reads the number rather than the status. The route
descriptions for hold, release and close say what they accept; the OpenAPI snapshot and the
generated client are regenerated. The user guide's status section describes the menu and the
consultation's two new steps. A held matter's step labels are keyed by status alone, so on a held
consultation the close reads Close Matter rather than Close Consultation; a rung-aware label is a
later refinement, recorded in the matter ledger's notes.
