---
number: 349
slug: open-tasks-advise-a-matter-close-and-never-block-it
status: Proposed
date: 2026-08-15
area: Tasks and workflows
summary: "Tasks register a close ADVISORY on the matter shell's advisory hook and never a close precondition, and the advisory carries a count of open tasks and no titles. The matter shell ships both hooks as deliberately separate mechanisms — a precondition blocks and may contribute an in-batch commit guard, an advisory returns notices that ride the successful response with no arm on which one becomes a refusal — and the advisory file's own reasoning is this exact case: one boolean away from each other, a subsystem that only meant to inform starts blocking closes on a Friday afternoon and the firm learns to route around the close screen. Trust blocks a close because holding client funds on a closed matter is a fiduciary failure; an open task is a reminder somebody wrote three months ago, and a matter that cannot close because of one produces a firm that cancels tasks it never read. Nothing happens to the tasks themselves: they are not cancelled, completed, deleted or swept, because closed is archived-but-additive and a close that mutated a dozen unrelated rows would contradict that shipped invariant. They stay open on the matter and drop out of the default my-tasks read through a filter on matters that are not closed, so reopening a matter restores them with no backfill and no state to repair."
---

**A matter closes with open tasks on it, and the close screen says so and does nothing else.**

**Context:** `packages/matters` ships two close hooks that are deliberately not one. A
`ClosePrecondition` answers "may this matter close?", fails the close on any failure, and may
contribute a `commitGuard` — a statement riding the close batch that aborts it if the condition its
check read has changed by commit time, because D1 has no interactive transaction. A `CloseAdvisory`
answers "what should the person closing it know?" and, in its own file's words, has "no arm on which a
notice becomes a refusal." Trust registers a precondition. Both registries in the matter shell are
empty by design, and the composition root passes rules in, so the shell never learns what money or
property is.

A task subsystem has to pick one, and picking wrong is quiet.

**Decision: tasks register an advisory. Never a precondition.**

The argument is written in `close-advisories.ts` already, and it is this case verbatim: "One boolean
away from each other, a subsystem that only meant to inform starts blocking closes on a Friday
afternoon, and the firm learns to route around the close screen."

Money blocks a close because holding client funds on a closed matter is a fiduciary failure with a bar
rule attached. An open task is a reminder somebody wrote three months ago, and half of them will be
stale by the time a matter is ready to close. A matter that cannot close because of one produces a
firm that bulk-cancels tasks it never read in order to get past a screen — which destroys the
information the block existed to protect, and teaches the firm that the close screen is an obstacle
rather than a check.

**The advisory carries a count and no titles.** "4 open tasks on this matter." A task title is free
text on a matter, and the confidentiality discipline that keeps it off the federated timeline and out
of a notification payload applies to a close response too — an advisory is not a special surface.

**Nothing happens to the tasks.** They are not cancelled, not completed, not deleted, not swept, and
not touched. The shipped invariant is that closed is **archived-but-additive** — a closed matter still
accepts documents — and a close that mutated a dozen unrelated rows in other subsystems' tables would
contradict it, besides making the close batch a place where task history is rewritten.

Open tasks stay open and stay on the matter. They **drop out of the default "my tasks" read through a
filter** on matters that are not closed — a filter, not a state change, so reopening a matter restores
its tasks with no backfill, no migration, and no state to repair. That is the same shape as the
calendar's read-time overdue: a fact that is a predicate cannot drift.

**Considered and rejected:** **a precondition with a firm setting to soften it** — the setting is the
boolean the two mechanisms exist to keep apart, and the first firm blocked on a Friday turns it off
permanently. **Auto-cancelling open tasks at close** — it destroys the record of what was outstanding
when the file was put away, which is exactly what somebody reconstructing the matter later wants.
**Auto-completing them** — a lie about work. **Listing the open task titles in the advisory** — free
text on a response, for a count's worth of value. **A `commitGuard` on the advisory** — advisories take
none, because there is nothing to re-assert: a notice that went stale between the read and the commit
was still true of the matter the person was looking at.

**Consequences:** closing a matter stays a single deliberate act that no reminder can block, and the
person closing it is told what is outstanding. Whether the close screen additionally offers a
bulk-cancel control beside the advisory is a product question with an obvious footgun, and it is
raised as an open owner flag rather than settled here.
