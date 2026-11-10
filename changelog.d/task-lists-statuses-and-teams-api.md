---
category: Added
audience: internal
---

**Task lists, the firm's own statuses, teams, and what a task now carries, through the API.** A
firm keeps several task lists, each with its own named and coloured statuses and a flow between
them, and teams a task can be assigned to in one step. A task gains a start date, a location, several
assignees (people and teams), watchers, a checklist, links and sub-tasks, and completion is its own
act that leaves the status where it stood. New routes: `/api/v1/task-lists` and its statuses and
flow, `/api/v1/task-teams`, and per task `status`, `list`, `completion`, `assignees`, `watchers`,
`checklist`, `links` and `/api/v1/tasks/subtask-trees`. The task list takes `listId`, `topLevel`,
`mine=assigned|watching|both` and `completed`. Every member now sees a task on no matter. The body
shapes live in `packages/tasks/src/contract.ts`. The screens that use this follow.
