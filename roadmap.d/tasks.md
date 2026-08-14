# Tasks and Workflows / Matter Plans

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Tasks and workflows -->

- id: tasks
  name: Tasks and workflows
  scope: Task lists with assignments and due dates, plus templated matter plans auto-instantiated per matter type.
  status: not-started
  evidence: No tasks schema, package, or spec; the matter detail skeleton's catch-all section mentions tasks only as future accumulated content.
  audience: public
  public-name: Tasks and matter plans
  public-summary: Task lists on a matter, and a plan that lays them out for you when a matter of that kind is opened.

- id: tasks.task-lists
  name: Task lists
  scope: Tasks with assignments and due dates on matters.
  status: not-started
  evidence: No task entity anywhere in packages/ or the per-firm schema.

- id: tasks.matter-plans
  name: Matter plans
  scope: Templated task/event/document sequences per matter type, auto-instantiated when a matter opens; pairs with document automation and the calendar.
  status: not-started
  evidence: No template or instantiation machinery; matter lifecycle (packages/matters) exists as the substrate it would hook.

- id: tasks.workflow-model
  name: Workflow model
  scope: Template authoring, task dependencies/sequencing, assignment and reassignment, due-date derivation (including from docketing), notification/escalation, completion tracking.
  status: researching
  evidence: White paper flags the workflow model needs-development with a follow-up spec required; none exists.
