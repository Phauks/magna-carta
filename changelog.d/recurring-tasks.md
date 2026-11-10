---
category: Added
audience: public
---

**Repeating tasks.** `matter_task` gains `recurrence_rule`, `recurrence_mode`, `recurrence_occurrence_on` and `recurrence_next_task_id` (added columns, migration `20261110T032943_recurring-tasks`). Only the current copy is a row: `packages/tasks/src/recurrence-service.ts` writes the next one, guarded on its slot, either in the completion batch (`completed`) or from an hourly pass on the digest trigger once its start date has come in the task's zone (`scheduled`). The rule is read from each copy onward and a count runs down copy by copy. `PUT /api/v1/tasks/{taskId}/recurrence` sets or clears it, and an edit's `recurrenceScope` says whether a moved due date moves this copy or the series. The task window asks Repeats with the calendar's own control plus a Next One choice, and a repeat icon marks the task in the list and on the board.

## Public

**Tasks can repeat.** Turn on **Repeats** in a task to make it come round again, every day, week, month or year. Choose whether the next one appears when you complete this one, or on its own start date even if this one is still open. Only the current one sits in your list, and the next arrives with its checklist unticked and the same people on it.
