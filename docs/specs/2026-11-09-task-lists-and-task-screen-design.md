# Task lists, custom statuses and the new Tasks screen — design

**Status:** approved by the owner on 2026-11-09 after seven rounds of review on a clickable mockup.
The rulings below are his; this file records them and turns them into a build.

Builds on [`2026-08-15-tasks-and-matter-plans-design.md`](2026-08-15-tasks-and-matter-plans-design.md)
and supersedes its fixed rungs (To Do, In Progress, On Hold, Done) and the 2026-09-14 rung ruling.

## What the owner asked for

The Tasks screen is one table. A firm keeps **several task lists** (partners only, assignments, one
per case type) and every task sits on exactly **one** list. **Every member sees every task**: a list
has no visibility setting, and a one-click **Me Mode** narrows the screen to your own work, with
three views: Assigned To Me, Watching, Both.

A task carries a **Start Date** and a **Due Date**, a priority, **several assignees** (people or
**teams**), **watchers** (kept informed, not doing the work), a **location** (a room, an address or a
meeting link with Join), **links**, a **checklist**, and **sub-tasks** — full tasks under a parent,
which share its list and matter and can nest.

**Statuses are the firm's own**, per list: a name, a colour and a **flow** (which statuses a task may
move to from each one). The first status is where a new task starts. **Completing a task is separate
from status** and works from any status; a completed task leaves the open list. Archive and delete
are unchanged.

The table groups by List (default), Due Date, Assigned To, Status, Matter or nothing; start, due and
priority are edited in the row; the status is a coloured pill at the row's start that opens the
status menu with Mark Complete at its foot; sub-tasks fold from a chevron left of the title; a hover
button beside the title previews the detail and checklist; a View menu chooses one or two lines,
row size, and which columns show. A date that has passed is red, never labelled "Overdue". Lists
(with their statuses and flow) and teams are managed in **Task Settings**, opened from the Tasks
page, not from Settings.

The task window edits in place (no Edit button; a new task keeps Save), puts the status menu beside
Mark Complete, and keeps Print with a "..." of Duplicate, Archive and Delete.

## The data model

Everything is additive. `matter_task` is a parent table that a durable object cannot rebuild (see
`packages/database/src/per-firm-schema.ts`), so nothing on it is dropped or widened; new facts are
added columns or new tables.

| Table                           | Holds                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `task_list`                     | name, position, whether it is the firm's default list, retired_at                                      |
| `task_list_status`              | a list's status: name, colour (closed palette), position. The lowest position is where new tasks start |
| `task_list_status_transition`   | the flow: one row per allowed move from one status to another on the same list                         |
| `task_team`, `task_team_member` | a named group of members, assignable as one                                                            |
| `matter_task_assignee`          | a task's assignees, each a member or a team, in order                                                  |
| `matter_task_watcher`           | members watching a task                                                                                |
| `matter_task_checklist_item`    | text, done, position                                                                                   |
| `matter_task_link`              | url, optional label, position                                                                          |

Added to `matter_task`: `list_id`, `status_id`, `parent_task_id`, `starts_on` (a civil date, the due
date's shape), `location`.

**The migration** creates one list, "Tasks", marked default, with To Do, In Progress and On Hold and
every move between them allowed, puts every existing task on it with the status its rung named, and
copies each `assignee_user_id` into `matter_task_assignee`. Nothing is inferred and nothing is lost.

**Colours** are a closed vocabulary (gray, blue, orange, amber, green, purple, red) that the web
side maps to tokens, so a firm picks a colour without picking a hex value the design system never
reviewed.

**The rung columns retire.** `progress` keeps its CHECK and its default and is no longer written by
the product; `state` keeps meaning only whether the work is finished, which is exactly what
"complete" means now. The `/rung` endpoint stays for the external mirror seam and maps onto the
default list's statuses where the names match.

**`assignee_user_id` stays** as the first person among the assignees, written in the same batch as
the assignee rows. The "what is on my plate" index, the assignment notification and the mirror seam
all read it, and keeping it current is cheaper than rewriting each of them now. Me Mode reads the
assignee table, so a task assigned to a team you are on is yours.

## Rules the writes hold

- A sub-task's list and matter are its parent's, set at the write and moved with the parent. A
  sub-task tree is at most five deep, and a parent cannot become its own descendant.
- A status move must be allowed by the list's flow from the task's current status. Completing and
  reopening ignore the flow. Moving a task to another list puts it on that list's first status.
- A list cannot be retired while it is the default; a status cannot be removed while a task is on it.
- Exactly one list is the default, held by a partial unique index.

## Visibility

**Every member sees every task**, which changes one rule: a task with no matter used to be private to
its assignee and creator, and is now visible to the firm like any other. A task on a matter is still
screened by the matter's own visibility, so an ethical wall still hides a walled matter's tasks; the
owner's ruling removed list-level visibility, not matter-level.

## Permissions

Reading and writing tasks keep `tasks:read`, `tasks:write` and `tasks:assign`. Managing lists,
statuses, the flow and teams uses `tasks:managePlans`, the permission that already governs how the
firm's task work is set up.

## Build order

1. **The table groups into bands** (design system): `GridGrouping`, the band heading row,
   `DataTable.GroupByMenu`. Shared with the Notifications screen, which builds on it.
2. **The model**: migration, schema, the tasks package (statements, services, validation), the API
   (lists, statuses, flow, teams, assignees, watchers, checklist, links, sub-tasks, location, start
   date, Me Mode filters) and its tests.
3. **The Tasks screen**: the table, grouping, the View menu, Me Mode, inline edits, sub-task rows,
   the preview, and Task Settings.
4. **The task window**: inline edits, status beside Mark Complete, People, Checklist, Sub-Tasks,
   Links, Location, the "..." menu.

Each step lands on `main` on its own and leaves the product working.
