---
category: Added
audience: public
---

**Matter plans — `matter_plan_template`, `matter_plan_task_template`, eleven routes, and the two
provenance columns `matter_task` was deliberately left without.**

A plan is firm-authored configuration, never a record: rows come only from the createPlan route
behind `tasks:managePlans`, which is why both list reads are claimed bounded-by-construction rather
than paged. The platform seeds none, and the migration inserts none.

`proposeMatterPlan` is a PURE read — it computes the dates and resolves the roles and commits
nothing. `acceptMatterPlan` writes the kept subset in one batch, because a matter carrying six of
eleven steps after a half-failed batch is worse than one carrying none. The proposal is a GET and
acceptance is the POST, which is how the surface says out loud which one writes.

The anchor vocabulary is `matter_opened` and `none`, held by a CHECK so a third value is a reviewed
migration; every candidate beyond it is the front half of a docketing rule. `addCalendarDays` is the
one piece of date arithmetic in the package, and `test/no-arithmetic.test.ts` now pins that function's
uniqueness rather than the absence of arithmetic — an exception has to be visible to stay one.

Provenance is not a live link: a test edits every field of a template and asserts the accepted task
comes back byte-identical. Three more pin what the review exists to catch — an offset landing on a
Sunday, a role resolving to nobody and arriving NAMED rather than blank, and a kept step whose
predecessor was dropped waiting on nothing rather than on a task never created.

`opened_at` holds a civil date on some paths and an instant on others, so the anchor read cuts ten
characters rather than parsing — the same cut the note ordering already makes.

The offer is rendered on the matter's Tasks section rather than the new-matter screen: a matter
opened before its plan existed can still take it, and somebody who declined can come back.

## Public

Matter plans — your firm's own list of what a kind of matter takes.

Write one under **Settings → Matter Plans**: the calls, the letters, the filings a kind of matter
needs. When a matter of that kind is opened, its Tasks page offers the plan.

**A plan offers; it never imposes.** Press **Review** and you see exactly what it would add — each
step, the date it worked out, and who it would go to. Nothing exists at that point. Untick what this
matter does not need, fix anything wrong, and press Add. Closing the review adds nothing, which is
all declining is.

Two things a plan cannot know, and the review is where you catch them. **Dates are counted in plain
days** — nothing skips weekends and nothing knows about court holidays — so a step set to 14 days can
land on a Sunday, and the review flags it and lets you move it. And **a step names a role rather than
a person**, matched against that matter's own team, so where nobody holds the role the step arrives
unassigned and tells you which role could not be filled.

Editing a plan changes what it offers from now on and **never touches tasks already on a matter** —
those were reviewed and accepted as they stood. Plans are never deleted, only taken out of
circulation, because every task a plan produced records the plan and the step it came from.

**No plans come with Magna Carta, and that is on purpose.** A plan is a statement about how your firm
practises in your jurisdiction. One written by us, with a step missing or out of order, would look
authoritative precisely because it shipped with the software.

A plan cannot yet apply itself without review, and its dates can only count from the day the matter
opened.
