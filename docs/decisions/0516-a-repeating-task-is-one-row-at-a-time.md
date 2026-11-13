---
number: 516
slug: a-repeating-task-is-one-row-at-a-time
status: Accepted
date: 2026-11-10
area: Tasks
summary: "A repeating task is one row at a time: the next copy is written when it is due to appear, either when this one is completed or on the next copy's own start date, chosen per task (owner, 2026-11-10). The rule lives on each copy and is read from that copy onward, with a count running down. The copy carries the work, people, an unticked checklist and links, never sub-tasks, documents or time. A scheduled copy is made by an hourly pass in the task's own zone."
---

**A repeating task is one row at a time, and the firm chooses when the next appears.**

**Context:** the owner approved the repeating-task mockup on 2026-11-10 and, asked whether the next
copy should appear when the current one is completed or on its start date, answered "I can see it
either way, so allow a setting to toggle it".

**Decision — one row at a time.** Only the current copy exists. Materialising a series ahead would
fill every list with work nobody can act on yet and make an edit to the series an edit to dozens of
rows. The next copy is written when it is due to appear, and `recurrence_next_task_id` (unique)
records that it has been, so the write is guarded and a completion and the hourly pass meeting on
the same task make one copy.

**Decision — when the next one appears is per task.** `recurrence_mode` is `completed` (the default:
made in the same batch as the completion) or `scheduled` (made on the next copy's start date, or its
due date without one, whether or not this one is done).

**Decision — the rule is read from this copy onward.** Each copy stores the rule and the day of the
series it stands for (`recurrence_occurrence_on`); a `COUNT` is the number of copies remaining, and
the next copy gets the same rule with the count one lower. So no copy walks back to the start of the
series, and the civil-time walk's own bound never ends a long-running series early. Moving one
copy's due date leaves the series where it was; moving "this and later ones" moves the occurrence
with it. The next due date is the rule's next day, walked by `@magna-carta/civil-time`; the start
keeps the same number of calendar days before it. That is counting days on a rule a person chose,
not deriving a date from a rule of law.

**Decision — what is copied.** The words, the list (at its first status), priority, location,
assignees (retired teams dropped), watchers, the checklist unticked, and links. Not sub-tasks,
documents, time, or the event and deadline links: those are records of this round of the work. The
assignees are told, as for any new assignment.

**Decision — the hourly pass.** A scheduled copy appears on a day in the task's zone, so the pass
rides the hourly digest trigger rather than the daily one, which lands in the previous evening for
western zones. Its read is one indexed query per firm. When a scheduled series ends, the pass takes
the rule off the last copy so it stops reading it.

**Consequences:** a repeat needs a due date, and a sub-task cannot repeat on its own. Reopening a
completed copy does not take back the copy made from it.
