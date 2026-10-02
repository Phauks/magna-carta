---
number: 427
slug: a-plan-names-a-role-and-the-platform-ships-none
status: Proposed
date: 2026-09-02
area: Tasks
summary: "A matter plan's step names a ROLE rather than a member and carries a due-date ANCHOR rather than a date, and both are resolved against the individual matter when the plan is proposed — because a template is used many times and anything it hard-codes is wrong the moment it is used twice. The role is matched against `matter_assignment.assignment_role` through the same validity window `packages/document-assembly` and the notifications matter-team audience already read (a creation bound inclusive by civil day, an end bound exclusive by instant), and a role that matches nobody produces a step that is NAMED and unassigned rather than blank or silently given to the responsible attorney — inventing an obligation for somebody is worse than showing a gap. The anchor vocabulary is `matter_opened` and `none` and is held by a SQLite CHECK, because every candidate beyond it is the front half of a docketing rule. Separately and by the same reasoning at the catalog level: THE PLATFORM SHIPS NO PLANS. Every competitor ships plan libraries and their absence is a visible competitive cost, accepted because a plan is a statement about how one firm practises in one jurisdiction, and one shipped by the platform with a missing or misordered step is a malpractice vector carrying the platform's name — trusted precisely because it shipped, which is the calendar's own argument about computed dates one level up. Owner flags W11 and W12 remain open as the reviewed route to changing either."
---

**A template is used many times, so everything it hard-codes is wrong the second time.**

**Context:** A plan step has to say who does the work and when it is due, and the obvious encodings of
both are traps.

Naming a member freezes a staffing decision into firm configuration. A plan that gives the intake
letter to Sarah is correct until Sarah's matters are reassigned, at which point every matter opened
under that plan quietly produces work for the wrong person — and nothing about the plan looks wrong,
because it says exactly what it was authored to say.

Naming a date is worse. A plan cannot hold a date at all, because it is written once and applied to
matters opened months apart. So it has to hold a rule, and a rule about legal dates is the thing this
platform has spent a subsystem refusing to compute.

**Decision:** A role, an anchor, and a catalog the platform leaves empty.

- **`default_assignee_role` is matched against `matter_assignment.assignment_role`** at proposal
  time, through the validity window `packages/document-assembly/src/merge-statements.ts` and the
  notifications matter-team audience already read: a creation bound is a civil date inclusive of its
  day, an end bound is the ending instant and exclusive. Three readings of one window would
  eventually disagree and the one somebody acted on would be whichever they saw last.
- **A role that resolves to nobody produces a NAMED, unassigned step.** Not a blank — which would
  leave the reviewer wondering whether the plan meant to assign it — and emphatically not the
  responsible attorney, which is the tempting fallback and would have the platform inventing an
  obligation for a person nobody chose. The reviewer sees which role could not be filled and fills it.
- **The anchor vocabulary is `matter_opened` and `none`**, held by a CHECK. `matter_opened` is a fact
  the matter row already carries. There is no `service_date`, no `filing_date` and no trigger-event
  anchor, because each is the front half of a docketing rule and adding one invites the back half.
  What keeps the offset defensible is that it is plain calendar-day addition in one named function —
  adding fourteen days to a date is not the arithmetic the calendar forbids; deriving a court deadline
  from a rule is. Growing the vocabulary is owner flag **W12**, with the calendar's stated position on
  the other side of it.

**And the platform ships no plans.** This is the same argument at the catalog level and it is made
against the grain: every competitor ships plan libraries, a firm evaluating this platform will notice
their absence, and "ship them anyway" is the commercially obvious answer. It is wrong for the reason
the calendar refuses to compute dates. A plan asserts a procedure. A platform-shipped plan with a
missing step, a step in the wrong order, or a step that is right in Nevada and wrong in California is
a malpractice vector carrying the platform's name — and it is trusted *because* it shipped, by the
firm that would otherwise have thought the sequence through. What ships instead is an empty catalog
and an authoring surface worth using.

If the owner later wants a curated set, the shape already exists in the tree: the Nevada court-form
library and the trust-rules catalog are both jurisdiction-keyed reference data with attorney review
in the loop, and a plan library is the same shape with the same obligations. That is a research
workstream with its own spec, not a seed migration. Owner flag **W11**.

**Consequences.** `packages/tasks` gains `addCalendarDays` as its only date arithmetic, and the
package's source scan pins that function's UNIQUENESS rather than the absence of arithmetic — an
exception that is not visible stops being one. The proposal surfaces `anchorUnavailable` where a
matter records no opened day, because eleven undated steps with no explanation is worse than eleven
undated steps with one. And the authoring surface has to say both things in the firm's own words: the
settings screen states that days are plain days and that a role is resolved per matter, because a
person authoring "+14" who believes the platform will skip the weekend has been misled by silence.
