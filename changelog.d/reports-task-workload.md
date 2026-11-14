---
category: Added
audience: public
---

**A Tasks by Person report.** `GET /api/v1/reports/task-workload` (`reports:productivity`, live) counts each member's open tasks, how many are overdue and how many have no due date, with unassigned open tasks on a row of their own. Counts only: no task's title or words. The tasks package owns the read (`readTaskWorkload` in `packages/tasks/src/task-workload.ts`), "open" means what the matter-close notice means, and overdue is the calendar's comparison in each task's own zone. `packages/reporting/test/productivity-task-workload.test.ts` proves the people add up to every open task.

## Public

A new Tasks by Person report shows how many open and overdue tasks each person has.
