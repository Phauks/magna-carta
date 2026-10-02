---
number: 431
slug: a-time-entry-names-one-task-and-it-is-on-that-entrys-matter
status: Proposed
date: 2026-09-02
area: Tasks
summary: "A time entry may name the task it was worked on, as ONE nullable `task_id` on `time_entry` rather than a many-to-many join — answering scope-study flag T2 the way the study recommended. An entry split across two tasks needs an allocation of its minutes between them, and an allocation is a second ledger with its own rounding, its own disputes and its own audit; the honest encoding of a block of time that served two tasks is two entries, which the capture surface already supports and the billing narrative already wants. A join table remains an additive migration over this column's data should many-to-many ever be needed, and the reverse is not, so the cheaper direction is the one taken. The named task must be on the ENTRY'S OWN MATTER: a task on another matter would let one matter's time point at work another matter is paying for, and a task on NO matter is the firm's own work with no client matter to bill it to — so a null `matter_id` on the task is a refusal rather than a wildcard. SQLite cannot express either condition without a trigger, so `assertTaskOnMatter` in the timekeeping service is the enforcement and its tests are what keep it honest, under one refusal code on the `file-not-on-matter` model. The time read back is MINUTES AND NEVER MONEY, because what a task cost is a question with a different audience and a different permission; it is batched over a page of tasks by construction, and whose time it counts is the reader's `time:viewFirm` answer arriving as data, with the scope travelling beside the totals so a surface cannot render the number without saying which it is."
---

**A link is cheap; an allocation is a ledger.**

**Context:** The brief asked for tasks that link to time entries, and the scope study raised the
shape of that link as flag **T2**: one entry to one task, or many-to-many. The question looks like a
modelling preference and is not.

Many-to-many is the more expressive schema and it does not stop at the schema. The moment one entry
can serve two tasks, something has to say how much of its 0.4 went to each — and there is no honest
default. Split evenly and the numbers are fiction. Leave it unallocated and every read over the link
("how long did this task take") has to either double-count the entry or refuse to answer. Store the
split and it is a second set of books over the same minutes, with its own rounding, its own
reconciliation against the entry it came from, and its own audit trail, sitting beside a
work-in-progress store whose whole discipline is that time is the timekeeper's own record.

**Decision:** One nullable `task_id` on `time_entry`, and the task must be on the entry's matter.

- **One task per entry.** A block of time that genuinely served two tasks is recorded as two
  entries. That is not a workaround: the narrative on a bill wants the split anyway, the capture
  surface already supports it, and the timekeeper is the person who knows how the time divided.
- **The direction is the cheap one.** If many-to-many is ever wanted, a join table is an additive
  migration seeded from this column. Going the other way — collapsing an allocated many-to-many into
  one link — throws away data nobody can reconstruct. Taking the reversible option first is what
  makes answering T2 now, rather than deferring it, safe.
- **The task is on the ENTRY'S OWN MATTER, and there are two ways to get that wrong.** A task on
  another matter would let one matter's time point at work another matter is paying for — the kind
  of link that survives into a bill and is discovered by a client. A task on NO matter is the firm's
  own work (renewing the policy, interviewing a candidate), which by construction has no client
  matter to bill it to; a null `matter_id` there is a refusal, never a wildcard that matches
  everything. SQLite can express neither without a trigger, so `assertTaskOnMatter` is the whole
  enforcement, its tests are what keep it honest, and the schema comment says what the schema alone
  cannot. One refusal code covers all three failures, on the `file-not-on-matter` precedent, because
  the caller's remedy is identical.
- **The link is an ordinary business column**, so the billing freeze governs it: a billed or void
  entry refuses the edit like any other field, with no special case to remember.

**The read is minutes, and it is batched.** `readTaskTimeSummaries` answers how long a task took —
the number that eventually tells a firm whether its own plan estimates are honest. It does not carry
money: what a task COST has a different audience and a different permission, and a summary carrying
both would have to be gated by the stricter of the two everywhere it is read, which is how a
duration ends up hidden from the person who needed it. Void entries are excluded and every other
status counts, because a discarded capture is not an hour and a billed hour still is one.

It takes a SET of task identifiers and returns a map, because its caller is a paged list. A per-task
read would be an N+1 on the surface members open most, and it is the kind an EXPLAIN cannot see — a
per-task lookup has the same plan as the grouped one — so the load profile records its statement
count beside the timings and the smoke test asserts one statement for a page of fifty.

**Whose time it counts is the reader's, and the answer travels with the number.** `time:viewFirm`
sees what the task cost the firm; everybody else sees what they put into it, which is the same line
My Day already draws. The scope rides beside the totals rather than once per page, and the
redundancy is deliberate: the same two numbers mean two different things, and a consumer must not be
able to render one without the other.

**Consequences.** The summary rides the task list's own read rather than a route of its own, beside
the attachments read that was already there for the same reason; a standalone per-task endpoint was
built first and removed rather than left uncalled. `packages/tasks` gains no query over `time_entry`
— the work-in-progress store stays one package's, with one freeze contract and one permission — so
the composition happens at the route, which reads the tasks from one package and the minutes from
the other. A task on no matter can never carry time, which falls out of the cross-matter rule rather
than needing one of its own. And starting a timer from a task, the affordance people usually mean by
"linked", is deliberately NOT built here: the live-timer run store must become plural first, because
a replacing `start` silently destroys the first run's elapsed time and a start-from-task button
would multiply the places that hazard is reachable from.
