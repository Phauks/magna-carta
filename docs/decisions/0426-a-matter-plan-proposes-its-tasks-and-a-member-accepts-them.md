---
number: 426
slug: a-matter-plan-proposes-its-tasks-and-a-member-accepts-them
status: Accepted
date: 2026-09-01
area: Tasks
summary: "Opening a matter whose type carries a plan OFFERS that plan's tasks — with their proposed dates and role-resolved assignees — and writes nothing until a member accepts. This narrows the white paper's 'auto-instantiated when a matter is opened' and answers owner flag W8, decided 2026-09-01. Three things make the review worth its friction, and all three are properties of what a plan can get wrong rather than arguments from principle: a plan's offset is plain calendar-day addition with no weekend skip and no holiday calendar (deliberately, because business-day arithmetic is the docketing engine this platform refuses to build), so a template can land a task on Christmas Day; a template names a ROLE and resolves it against the matter's live team at instantiation, so opening a matter before staffing it produces tasks belonging to nobody; and assignment notifies, so automatic instantiation tells a member they own work on a matter they have never heard of, chosen by a template rather than a person. The countervailing case is real and is not dismissed: a firm opening forty matters a month of one tuned type gets forty identical confirmations and learns to accept without reading, which costs the friction and loses the benefit. That is answered by a per-template 'instantiate automatically' setting as a fast follow rather than by making automatic the default — the firm decides which of its own plans it trusts, which is not a judgment the platform can make for them."
---

**A plan proposes; a person accepts. Nothing dated is written onto a matter that nobody read.**

**Context:** The white paper says matter plans are "auto-instantiated when a matter is opened." The
tasks design narrowed that to propose-and-confirm and raised the narrowing as owner flag **W8**,
because the two readings produce genuinely different products for a high-volume firm and the choice
is a product decision rather than a design consequence.

The moment in question is small and specific: somebody opens a new matter of a type that has a plan
attached and presses Save. Automatic means eleven tasks appear, dated and partly assigned, in one
click. Propose-and-confirm means the screen shows those eleven with their proposed dates and
assignees, and the person ticks, edits or declines before anything exists.

**Decision:** Propose-and-confirm. Acceptance is the write; a declined plan leaves zero rows.

What decides it is not a preference for caution but three things a plan can get wrong, each of which
the review catches and automatic does not:

- **A proposed date can be absurd.** The offset is plain calendar-day addition — no business-day
  skip, no court-holiday calendar, no service-method offset — and that is deliberate, because
  deriving a date from a rule is the docketing engine `packages/calendar` has spent a subsystem
  refusing to build. The honest consequence is that "matter opened + 14" on a matter opened on the
  11th of December is due on Christmas Day. A person moves that date in a second; a template cannot
  know to.
- **A role can resolve to nobody.** A template names a role rather than a member, resolved against
  the matter's live `matter_assignment` rows at instantiation, and an unresolved role leaves the task
  unassigned and visibly so rather than quietly giving it to the responsible attorney. A matter
  opened before it is staffed therefore produces tasks nobody owns. The review is where that is seen
  while it can still be fixed.
- **Assignment notifies.** Automatic instantiation tells a member they own work on a matter they have
  never heard of, chosen by a template rather than by a colleague.

Underneath those: eleven dated obligations that appeared on a file nobody read still READ as
authoritative, and a task list sitting beside a deadline list inherits some of that list's weight. A
wrong entry that no human ever agreed to is the trusted-because-computed failure the calendar's
no-arithmetic position exists to prevent, arriving through a different door.

**The countervailing case is real.** A firm opening forty matters a month of one well-tuned type gets
forty confirmation screens that say the same thing and are always accepted — which is worse than
either pure option, because it charges the friction and then trains people to click through without
reading, so the tasks end up unreviewed anyway.

That is answered by a **per-template `instantiate automatically` setting**, as a fast follow rather
than as the default. A firm that has run its intake plan two hundred times turns it on for that
template; a plan that is new, rarely used, or dense with dates keeps its review. Which of a firm's
own plans deserve that trust is the firm's judgment and not one the platform can make on its behalf.

**Consequences.** Instantiation is a pure computation over the template and the matter that writes
nothing; the accepted set writes every task in one batch with the two provenance columns filled. The
setting is one boolean on `matter_plan_template` rather than a second code path, because automatic is
the cheap direction to add once propose exists and propose is not addable once automatic ships. This
decision settles W8 alone: **W11** (whether the platform ever ships curated plans of its own) and
**W12** (whether the anchor vocabulary may grow past `matter_opened`) remain open, and the design's
own answers to both — ship none, keep the vocabulary at one value — are safe defaults the build can
proceed under.
