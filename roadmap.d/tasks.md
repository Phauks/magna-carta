# Tasks and Workflows / Matter Plans

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Tasks and workflows -->

- id: tasks
  name: Tasks and workflows
  scope: Task lists with assignments and due dates, plus templated matter plans auto-instantiated per matter type.
  status: not-started
  evidence: No tasks schema, package, route, or identifier type; the matter detail skeleton's catch-all section mentions tasks only as future accumulated content. The follow-up spec the white paper asked for is written (docs/specs/2026-08-15-tasks-and-matter-plans-design.md), with its primitive (docs/specs/2026-08-15-notes-and-activity-design.md) and an implementation plan, and all three are Proposed pending owner flags, so nothing here moves off not-started and no node carries a spec key yet.
  audience: public
  public-name: Tasks and matter plans
  public-summary: Task lists on a matter, and a plan that lays them out for you when a matter of that kind is opened.

- id: tasks.task-lists
  name: Task lists
  scope: Tasks with assignments and due dates on matters.
  status: not-started
  evidence: No task entity anywhere in packages/ or the per-firm schema, and no TaskId among the identifier types. The design settles that a task is neither a calendar event nor a deadline, and that its due date reaches the calendar's civil-date resolver rather than a docketing engine, because there is none.

- id: tasks.matter-plans
  name: Matter plans
  scope: Templated task/event/document sequences per matter type, auto-instantiated when a matter opens; pairs with document automation and the calendar.
  status: not-started
  evidence: No template or instantiation machinery; matter lifecycle (packages/matters) exists as the substrate it would hook, and matter_assignment is the live team table a template's role would resolve against. The design narrows auto-instantiation to propose-and-confirm and ships no platform templates.

- id: tasks.workflow-model
  name: Workflow model
  scope: Template authoring, task dependencies/sequencing, assignment and reassignment, due-date derivation (including from docketing), notification/escalation, completion tracking.
  status: not-started
  evidence: Corrected from researching, which the vocabulary reserves for a named open research workstream — the white paper's Open research workstreams names only the trust-rules catalog and the competitive analysis, so this was a needs-development note rather than a research stream. The spec it asked for now exists and is Proposed pending owner flags; nothing is built.
