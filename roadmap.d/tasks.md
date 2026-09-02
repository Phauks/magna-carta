# Tasks and Workflows / Matter Plans

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Tasks and workflows -->

- id: tasks
  name: Tasks and workflows
  scope: Task lists with assignments and due dates, plus templated matter plans auto-instantiated per matter type.
  status: partial
  slices: 6-3-tasks
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: The task record ships end to end — packages/tasks, the matter_task and matter_task_document tables, three permission keys, eleven routes, the matterTask timeline source, a matter close advisory, the Tasks section and My Work at /tasks. Matter plans are the unbuilt half and are what holds this node at partial rather than built.
  audience: public
  public-name: Tasks and matter plans
  public-summary: Task lists on a matter, and a plan that lays them out for you when a matter of that kind is opened.
  awaiting-owner: W7 and W8 are both answered — W7 by event (the note primitive shipped first and tasks were built on the activity stream it settled), W8 by the owner on 2026-09-01 (a plan proposes its tasks and a member accepts them; acceptance is the write). Four calls raised by the 2026-09-01 scope study remain open and shape the remainder rather than the record: T2 (whether a time entry's task link is one-to-one or many-to-many), T3 (firm-defined task statuses, which the board view needs), T4 (comments on a task) and T5 (a flat checklist inside one, which the design's refusal of task TREES does not settle).

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
  scope: Templated task/event/document sequences per matter type, auto-instantiated when a matter opens; pairs with document automation and the calendar.
  status: designed
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: No template or instantiation machinery. What the task slice built is the substrate a plan instantiates INTO — matter_task with its provenance columns still absent, and matter_assignment as the live team table a template's role would resolve against. The design narrows auto-instantiation to propose-and-confirm and ships no platform templates. Corrected from not-started: the design exists and is Proposed, which is what designed means.
  awaiting-owner: Two calls about how far a plan may reach. Whether the platform ever ships curated matter plans of its own — the design ships none and gives the malpractice argument, and a yes makes it a jurisdiction-keyed reference catalog with attorney review in the loop, a research workstream rather than a seed migration. And whether a template's anchor vocabulary may grow beyond "matter opened": every other candidate anchor — service date, filing date, a trigger event — is the front half of a docketing rule, and keeping the vocabulary at one value is the whole reason the offset arithmetic is defensible while the calendar refuses to compute deadlines. Tasks and matter plans design flags W11 and W12.

- id: tasks.workflow-model
  name: Workflow model
  scope: Template authoring, task dependencies/sequencing, assignment and reassignment, due-date derivation (including from docketing), notification/escalation, completion tracking.
  status: partial
  slices: 6-3-tasks
  surface: screen
  spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
  evidence: Shipped — assignment and reassignment as separate acts behind their own permission, one-predecessor sequencing that renders and sorts but gates nothing, completion tracking with reopening, and notification of assignment through four topics and a new named-recipient audience. Unbuilt — template authoring, and escalation beyond the registry field that already carries it. Due-date derivation is deliberately absent rather than pending: nothing derives a date, and the plan-template offset that would is gated on flag W12.
