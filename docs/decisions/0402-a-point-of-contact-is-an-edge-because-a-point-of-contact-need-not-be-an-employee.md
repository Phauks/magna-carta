---
number: 402
slug: a-point-of-contact-is-an-edge-because-a-point-of-contact-need-not-be-an-employee
status: Accepted — built 2026-09-02 (the type is in the catalog and classed; the record screen offers it)
date: 2026-08-30
area: Directory
summary: "The owner's direction is that the platform must record who the point person with an organization is. The design left two options open: a new edge type, or a flag on an employment edge. The flag is wrong, and the reason is not aesthetic — the people a firm actually talks to at an organization are frequently not its employees. A court's clerk of court, an insurer's assigned adjuster at a third-party administrator, opposing counsel's paralegal, a designated agent for service, a trustee's accountant: every one of them is the point of contact and none of them is on the organization's payroll. A flag on an employment edge cannot express any of them without first asserting an employment that is false, and a false employment edge is not a cosmetic error — the conflicts traversal spends a control-class budget on it. So point of contact is its own edge type, point_of_contact_for, and it stands alone: a person who is BOTH an employee and the point of contact carries two edges, which is correct because they are two facts with two validity periods. The build is blocked on one line outside this stream's ownership: a new edge type must be classed in packages/conflicts/src/edge-classes.ts in the same change, which the existing coverage test enforces."
---

**A point of contact is its own edge, because a point of contact need not be an employee.**

**Context:** the owner's direction was that the platform should record "who the point person with an
organization is". The directory design left the shape open between an edge type of its own and a flag
on the employment edge, and asked for the choice to be made with a reason.

**Decision: an edge type, `point_of_contact_for`, standing on its own.**

**The reason is that the flag cannot express the ordinary case.** Consider who a firm actually deals
with at an organization:

- a **clerk of court** — the point of contact at the court, employed by the judiciary, not by the
  case;
- an **assigned adjuster at a third-party administrator** — the point of contact for an insurer,
  employed by a different company entirely;
- **opposing counsel's paralegal** — the point of contact at the other firm for scheduling, and a
  person the firm may contact when Rule 4.2 forbids contacting the party;
- a **registered agent for service of process** — the point of contact for service, a commercial
  service that has never employed anyone at the organization;
- an **outside accountant or company secretary** for a small trading entity.

A flag on an employment edge can record none of these without first asserting an employment
relationship that is false. That is not a cosmetic error. `directory_edge` is the corpus the conflicts
traversal walks, and an invented employment edge is walked at the employment class's budget and
printed on a conflicts report as a relationship the firm asserted. A record that says the court clerk
is employed by the court is defensible; a record that says the registered agent is employed by the
company is a false statement in a document the firm may have to stand behind.

**A person who is both an employee and the point of contact carries two edges.** That reads as
duplication on a relationships pane and it is not: an employment and a point-of-contact appointment
start and end at different times, and one person stops being the contact long before they stop being
employed. Two edges carry two validity periods; one edge with a flag carries one.

**Class: `constituent`.** Being the person a firm phones is not authority to bind the organization,
which is the line Rule 4.2's comment on organizational constituents draws and the line the edge
classes are budgeted around. A point of contact who CAN bind — an officer who is also the named
contact — carries the officer edge as well, and that is what gives them the control-class weight.

**Considered and rejected:** a flag on the employment edge (it forces a false employment for every
non-employee contact, and a false edge is walked and printed); a column on `directory_organization`
naming one contact person (an organization has more than one — a billing contact, a records custodian,
a scheduling contact — and a single column silently loses the others); leaving it to
`directory_edge.role` free text (the role column is a human note, and a picker that has to offer "who
do we talk to" cannot be built on a free-text column any more than the phone label could be).

**Build status, stated rather than implied.** The catalog entry is not yet added. `EDGE_TYPES` lives in
`packages/directory/src/types.ts` and every entry must be classed in
`packages/conflicts/src/edge-classes.ts` in the same change — the existing coverage test refuses a type
with no class beside it, which is the right constraint and is why this cannot land half-done. The
conflicts package was outside this stream's file ownership, so the decision is recorded here and the
one-line catalog change is the whole of what remains, alongside the wider edge-catalog work the
constituent-class decision describes.
