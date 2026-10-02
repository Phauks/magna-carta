---
number: 345
slug: a-plan-proposes-a-date-and-a-member-accepts-it
status: Proposed
date: 2026-08-15
area: Tasks and workflows
summary: "A matter-plan template carries a due-date anchor and an integer offset rather than a date, instantiation renders a proposed civil date, and nothing is written until a member accepts — which is the propose-and-confirm interaction the calendar already reserved for the statutory catalog it has not built, reused rather than reinvented. Three things keep the offset from being the date engine this platform spends a subsystem refusing to build: the arithmetic is plain calendar-day addition in the matter's zone with no business days, no holiday calendar and no service-method offset, which is not the derivation the calendar forbids; the anchor vocabulary holds exactly one real value, matter_opened, and deliberately has no service-date, filing-date or trigger-event anchor, because each of those is the front half of a docketing rule and adding one invites the back half, so the vocabulary is a CHECK constraint that grows only by a reviewed migration; and acceptance is the write, so no obligation exists on a matter that a person did not read. This also narrows the white paper's auto-instantiated-when-a-matter-opens promise on purpose — eleven dated obligations written onto a matter nobody read is the trusted-because-computed failure again — while leaving automatic instantiation available as a per-template firm setting rather than a platform default."
---

**A plan may suggest a date. Only a person may create one.**

**Context:** the useful half of a matter plan is that it knows when things are due — "file the answer
fourteen days after service" is the sentence a firm wants a template to hold. Writing that literally
builds the date engine this platform has spent a whole subsystem refusing to build, and it builds it
in the least visible place: a template offset column, added by whoever was implementing plans, with no
invariant anywhere near it.

The calendar's position is a capital-letter invariant — nothing computes a deadline date — and its
reasoning is that a computed deadline that is wrong is worse than none, because it is trusted
precisely because it was computed.

**Decision:** a template task carries a **due-date anchor** and an integer **offset in days**.
Instantiation renders a **proposed** civil date and writes nothing. A member accepts, edits, or
declines, and the acceptance is the write.

That interaction is not invented here. The calendar already documented it for the statutory catalog it
reserved and left unreachable: **propose-and-confirm — a member accepts a proposed date and that
acceptance creates the row, the catalog never writes one by itself, and an existing row is never
recomputed when the catalog changes.** A matter plan is the first consumer of that pattern and uses it
exactly.

**Three things keep the offset honest rather than making it a loophole.**

**Plain calendar days, in the matter's zone.** No business-day skip, no court-holiday calendar, no
service-method offset, no chained recalculation. Adding fourteen days to a date is arithmetic; deriving
a court deadline from a rule is a legal conclusion, and only the second is what the calendar forbids.
The renderer is one named function with that distinction written inline, and it is the single named
exception in the tasks package's date-arithmetic scan — named, so it is reviewed rather than
accumulated.

**The anchor vocabulary holds one real value.** `matter_opened`, plus `none`. There is no
`service_date` anchor, no `filing_date` anchor, and no trigger-event anchor, because every one of those
is the front half of a docketing rule and the person who adds one will be immediately asked for the
back half — business days, then holidays, then the jurisdiction that decides which holidays. The
vocabulary is a CHECK constraint precisely so growing it costs a migration somebody reviews, on the
model of the calendar's reviewed firm-anchor allowlist.

**Acceptance is the write.** No obligation lands on a matter that a person did not read.

**This narrows the white paper on purpose.** It promises plans "auto-instantiated when a matter is
opened"; this design offers the plan at open and waits. Eleven dated obligations written onto a matter
nobody read is the trusted-because-computed failure with a different subject. Automatic instantiation
stays available as a **per-template firm setting** for a firm opening forty matters a month — which is
a real need and a legitimate answer — rather than as the platform's default, and that is raised as an
open owner flag.

**Considered and rejected:** **a full offset expression language** (business days, holiday sets,
service-method modifiers) — it is the docketing engine, arriving through the back door with none of
the jurisdiction research that engine would require. **Writing the proposed dates and flagging them
unconfirmed** — a flag on a row that already exists is a row that already exists; it will be sorted,
reported and relied on. **No offsets at all, every plan task undated** — it removes the feature's
actual value, and a firm would compute the dates in a spreadsheet instead, which is worse in every way
including auditability. **Recomputing proposals when a template changes** — the recomputation the
calendar refuses, and the companion decision on instantiation already rules it out.

**Consequences:** a plan is useful without the platform asserting a legal conclusion, and the seam it
uses is the one already reserved for the day a verified rule catalog exists — at which point a plan
task's proposed date can come from the catalog through the identical acceptance step, with no change
to the plan model at all.
