---
number: 441
slug: the-matter-lifecycle-has-an-intake-rung-and-the-consultation-is-named-for-the-phase
status: Accepted
date: 2026-09-05
area: Matters
summary: "A matter passes through intake, consultation, open and closed, stored as spelled. An intake is the walk from first contact to a consultation: the matter row exists from the first call, because the conflicts check, the files, the calendar and every intake-procedure reader are anchored on a matter and a prospective client is owed the record from the first consultation, but it carries no number of any kind and lives on the Intake desk rather than the docket. The firm's intake procedure gates graduation from intake to consultation, which draws the consultation number; a consultation opens on the firm's decision with no intake gate. The second rung is spelled consultation rather than prospective, because prospective is the conduct rules' word for the client's standing while consultation is the firm's word for the phase, and the product already said consultation everywhere but the status chip. The stored value is renamed, not mapped, because no firm holds a matter at this date."
---

**A matter has four rungs — intake, consultation, open, closed — and the intake procedure holds the
door between the first two.**

**Context:** the intake desk was first built on the two-rung lifecycle of ADR-0080, treating an
intake in flight as a prospective matter with required steps outstanding. The owner's instinct was
that intake should not have a matter yet, that intake is the walk to prospective and graduates into
it, and that "prospective" might be the wrong word. The analysis put to the owner was that the
matter row at first contact is structural rather than accidental — every subsystem an intake step
reads is anchored on a matter, and the conduct rules want the record from the first consultation —
and that the missing thing was a rung, not a record. The owner chose the rung, chose the word
"consultation", and, since no firm yet holds a matter, chose to store it as spelled rather than map
it.

**Decision:** `matter.status` is one of `intake`, `consultation`, `open`, `closed`. Creating a
matter in `intake` draws nothing. `graduateMatter` (intake to consultation) runs the registered
graduation preconditions — the intake procedure — and draws the consultation number in the same
bounded-retry draw the open uses, with the same in-batch status guard and post-commit confirmation.
`openMatter` requires a consultation and runs no intake gate. Reopening a closed matter returns it to
the rung it left, read from the honest signals: `opened_at`, then the consultation number, else
intake. The working docket excludes both unnumbered rungs; the Consultations view shows
consultations; the Intake desk shows both. The status register prints Intake and Consultation; the
word "prospective" survives only where it means the client's standing under Rule 1.18.

**Considered and rejected:** a separate intake record that becomes a matter on graduation, because
the conflicts check, the files, the calendar and the checklist readers would all need a pre-matter
home or would have to wait, and graduation becomes a migration; deriving the intake phase from the
checklist with no stored status, because a stored graduation is a recorded act a firm can point to
and a derived one moves when the procedure is edited; keeping the stored value `prospective` under a
printed "Consultation" (the `open`/"Active" precedent), because with no rows to carry the rename is
free and a code that disagrees with its word is a cost paid on every read of the schema; and
letting the intake procedure gate both graduation and opening, because the owner's ordering puts
the firm's requirements before the consultation and a second gate on the same list would refuse the
open for a step the firm already accepted.

**Consequences:** a reviewed rebuild of `matter` widens the CHECK; `POST /api/v1/matters/{id}/graduate`
and `GET /api/v1/matters/{id}/graduate-readiness` join the lifecycle routes under `matters:create`;
the intake package's precondition is renamed to the door it holds; the desk gains a Status column
and Complete Intake; the status window gains the Complete Intake step with Requirements To Complete
Intake; every surface and test that spelled `prospective` now spells `consultation`, and the usage
report counts intakes. Spec:
[`docs/specs/2026-09-05-intake-desk-design.md`](../../specs/2026-09-05-intake-desk-design.md).
