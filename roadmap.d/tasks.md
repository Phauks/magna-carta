# Tasks and Workflows / Matter Plans

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Tasks and workflows -->

- id: tasks
  name: Tasks and workflows
  scope: Task lists with assignments and due dates, plus templated matter plans auto-instantiated per matter type.
  status: partial
  slices: 6-3-tasks
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: The task record, the matter plan and the time link all ship — packages/tasks, the matter_task, matter_task_document, matter_plan_template and matter_plan_task_template tables, a nullable task_id on time_entry, four permission keys, twenty-two routes, the matterTask timeline source, a matter close advisory, the Tasks section, My Work at /tasks, plan authoring under Settings, and a task volume in the load-profile harness. What holds this node at partial is the rest of the workflow surface: the board and its firm-defined statuses, recurrence, watchers and comments.
  audience: public
  public-name: Tasks and matter plans
  public-summary: Task lists on a matter, and a plan that lays them out for you when a matter of that kind is opened.
  awaiting-owner: W7 and W8 are both answered and both built — W7 by event (the note primitive shipped first and tasks were built on the activity stream it settled), W8 by the owner on 2026-09-01 (a plan proposes its tasks and a member accepts them; acceptance is the write). T2 is answered and built the way the scope study recommended: one nullable task_id on time_entry, because an entry split across two tasks needs an allocation of its minutes and an allocation is a second ledger. Three calls raised by that study remain open and shape the remainder rather than the record: T3 (firm-defined task statuses, which the board view needs), T4 (comments on a task) and T5 (a flat checklist inside one, which the design's refusal of task TREES does not settle).

- id: tasks.task-lists
  name: Task lists
  scope: Tasks with assignments and due dates, on a matter or on none.
  status: shipped
  slices: 6-3-tasks
  surface: screen
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: packages/tasks with matter_task and matter_task_document, matterTask and matterTaskDocument identifier types, tasks:read/write/assign, and eleven routes. matter_id is nullable so firm work with no client file lives here too, with the visibility branch confined to taskVisibilityFragment. No date is derived and no overdue column exists — both held by source and schema scans. Cancellation and deletion are both real and distinguished. Two screens: the matter's Tasks section and My Work.

- id: tasks.matter-plans
  name: Matter plans
  scope: Templated task sequences per matter type, offered when a matter is open and written only when a member accepts them; pairs with document automation and the calendar.
  status: partial
  slices: 6-3-tasks
  surface: screen
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: matter_plan_template and matter_plan_task_template, tasks:managePlans, eleven routes, and plan authoring under Settings. A proposal is a GET that writes nothing and acceptance is the POST that writes, so a plan is an offer a person edits and confirms rather than rows that appear. Provenance lands on matter_task as plan_template_id and plan_task_template_id, and nothing reconciles afterwards — the tasks are the firm's, not the template's. Partial because only task steps are templated: the design's event and document steps are unbuilt, and a plan cannot yet reach the calendar or document automation.
  awaiting-owner: Two calls about how far a plan may reach, neither of them blocking — the build took the design's own answer to each. Whether the platform ever ships curated matter plans of its own: it ships none, the malpractice argument holds, and a yes makes it a jurisdiction-keyed reference catalog with attorney review in the loop, a research workstream rather than a seed migration. And whether a template's anchor vocabulary may grow beyond "matter opened": it stays at that one value, because every other candidate anchor — service date, filing date, a trigger event — is the front half of a docketing rule, and one anchor is the whole reason the offset arithmetic is defensible while the calendar refuses to compute deadlines. Tasks and matter plans design flags W11 and W12.

- id: tasks.workflow-model
  name: Workflow model
  scope: Template authoring, task dependencies/sequencing, assignment and reassignment, due-date derivation (including from docketing), notification/escalation, completion tracking.
  status: partial
  slices: 6-3-tasks
  surface: screen
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: Shipped — assignment and reassignment as separate acts behind their own permission, one-predecessor sequencing that renders and sorts but gates nothing, completion tracking with reopening, notification of assignment through four topics and a new named-recipient audience, template authoring with role-based default assignment, and the time link: one nullable task_id on time_entry, refused unless the task is on the entry's own matter, with the minutes read back grouped over a whole page of tasks rather than one read per row. Unbuilt — escalation beyond the registry field that already carries it. Due-date derivation stays deliberately absent: nothing derives a task's date, and the one piece of date arithmetic in the package is addCalendarDays, named and isolated so the source scan can see it, applied only to a template offset a person reviews before it becomes a task.
