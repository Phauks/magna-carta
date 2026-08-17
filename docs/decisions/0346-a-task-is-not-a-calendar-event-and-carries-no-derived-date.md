---
number: 346
slug: a-task-is-not-a-calendar-event-and-carries-no-derived-date
status: Proposed
date: 2026-08-15
area: Tasks and workflows
summary: "A task is its own record with an assignee and a completion state, not a calendar event and not a deadline — the continuance discipline that makes a rescheduled hearing two rows is exactly wrong for a due date somebody changed their mind about, and diluting the deadline table with reminders would degrade the one surface where a missed entry is a malpractice event. A task may carry an optional link to the event that prompted it and to the deadline it serves, and both are links and never inputs to a calculation. The date finding matters more than the modelling: there is no date engine in this platform to reach. The calendar states as a capital-letter invariant that nothing computes a deadline date — no business-day arithmetic, no holiday calendar, no service-method offsets, no cascade when a trigger moves — its time-zone module states that it never derives a date from another date, and the docketing ledger node records the absence as a deliberate position rather than a gap. So a task stores the three columns a deadline stores, a civil date, an optional wall-clock time and a required zone, resolves them to an instant through the calendar's own civil-date resolver with a dateless task due at the end of its civil day, and computes overdue at read time with no column, no flag and no sweep — an argument that is stronger for tasks than for deadlines, because tasks are numerous and a nightly sweep across every firm's is precisely the scheduled work the platform keeps off itself."
---

**A task is a third thing, and the date machinery it reaches is a civil-date resolver rather than the
rule engine everybody assumes is there.**

**Context:** three records on a matter carry a date, and the temptation is to collapse them. A
calendar event is a proceeding with participants, a shared type catalog, and a continuance discipline
in which a rescheduled hearing produces a second row because both settings really happened. A deadline
is an obligation with a state, an authority note, and a link to the event that started the clock. A
task has an **assignee** and a **completion state**, which neither of the others has, and no external
reality at all — nobody continues a task, nothing vacates it, and no court knows it exists.

**Decision, part one: a task is its own record.**

Modelling it as a calendar event imports the continuance discipline, which is exactly wrong here. A
hearing moving from the 3rd to the 17th is two real settings and the calendar records both, held to a
chain by two partial unique indexes. A task's due date moving is somebody changing their mind, and
recording it as two rows would put two items on the assignee's list and make every consumer
responsible for hiding one. The calendar already drew this line for its own firm events, which keep
edit-in-place semantics because a moved staff meeting is not procedural history; a task sits further
along the same side.

Modelling it as a deadline is worse. A deadline is the firm's obligation to a court or a rule, and its
table's whole purpose is that a missing entry is a malpractice event. Filling it with "call the client
back" produces a deadline surface that is mostly reminders, which is a deadline surface people stop
reading.

What a task may have is a **link**: an optional reference to the event that prompted it and an optional
reference to the deadline it serves, so a firm can see which obligations have no work scheduled
against them. Both are references under the calendar's own rule about its trigger link — a link to the
event that started the clock, and never an input to a calculation.

**Decision, part two, and it is the finding: there is no date engine to reach.**

The brief for this work assumed the calendar ships rules-based docketing, so a task due "14 days after
service" would reuse the deadline computation. It does not exist. The calendar states as an invariant
in capitals that **nothing computes a deadline date** — no business-day arithmetic, no court-holiday
calendar, no service-method offsets, no cascade when a trigger event moves, no inference of a
jurisdiction from anything — with the reasoning that a computed deadline that is wrong is worse than
none, because it gets trusted precisely because it was computed. Its time-zone module says the same in
its own header: it never derives a date from another date. A test scans the sources for date-arithmetic
identifiers. And the docketing ledger node records the absence as "a deliberate position, not a gap."

So a task reaches the machinery that does exist, and adds nothing:

- **Three columns, the deadline's.** A civil date, an optional wall-clock time, and a **required**
  zone. Not a UTC instant, on the calendar's invariant that no column stores midnight-local-as-UTC —
  the daylight-saving off-by-one that moves an obligation by a day when the clocks change. That bug is
  lower-stakes and much higher-frequency on tasks.
- **Resolution through the calendar's own civil-date resolver**, and a task with a date and no time is
  due at the **end** of that civil day in its zone, for the reason written beside that function:
  rendering it as midnight reports a whole working day of obligations as already missed.
- **Overdue is a read-time comparison with no column, no flag and no sweep.** The calendar's position
  exactly, and stronger here: tasks are numerous, and a nightly overdue sweep across every firm's is
  precisely the heavy scheduled work this platform keeps off itself.
- **A task's zone is the assignee's office zone frozen at assignment** — the discipline resource
  bookings already use, so an office zone change never reinterprets an existing task, and a
  reassignment across offices does not silently move a due date by three hours.

**Considered and rejected:** **a task as a calendar event with a `task` event type** — cheap, and it
inherits continuance, participants and bookings, none of which a task has any use for. **A task as a
deadline with a `soft` flag** — the flag is the whole distinction, and it degrades the surface that
must not be degraded. **Storing a resolved UTC instant beside the civil date** for cheap sorting — two
representations of one fact, and the derived one is wrong twice a year. **An `overdue` column
maintained by a scheduled job** — stale exactly when it matters, and a sweep per firm for a fact that
is a subtraction.

**Consequences:** when a docketing engine eventually exists, a task needs no schema change — its
column shape is already the deadline's, so a derived date lands the same way for both through one
engine. Until then, a task's due date is a date a person chose, which is the only kind this platform
is currently in a position to stand behind.
