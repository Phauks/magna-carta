# Tasks — the table, the people on a task, and the checklist inside one

**Date:** 2026-09-16
**Status:** Built. The owner's review of the deployed tasks surface, taken as a design brief; every
item is answered in the same change.
**Owner:** Trevor Goldsmith
**Reads against:** [`2026-08-15-tasks-and-matter-plans-design.md`](2026-08-15-tasks-and-matter-plans-design.md)
(the record) and [`2026-09-01-tasks-scope-study.md`](2026-09-01-tasks-scope-study.md) (the "ClickUp
inside Magna Carta" brief, which this design answers the second half of). Flags **T5** (a flat
checklist) is answered yes here; the study's "keep" on multiple assignees is reversed by the owner.
**Design standards this composes:** the owner's standing rulings
([`../conventions/design-corrections.md`](../conventions/design-corrections.md)), in particular the
_Lists and tables_ and _List screens_ rules, which bind this surface completely.

---

## 1. The brief

The owner, on the deployed tasks surface, 2026-09-16:

> what to do becomes Title. detail becomes description. need to include time zone for time.
> consider combining with functionality of calendar. task can be assigned to multiple parties. some
> parties may be responsible, some people may be assigned, some people may just want to watch it and
> get status updates. perhaps there are others as well. allow functionality to make to do lists, see
> Clickup functionality. attaching items from the matter should be on the top of the right side, i
> can only see one item at a time in current format. once task is made, there is no way to edit the
> task, change the status, update the information, change assignees. terrible design. show done and
> show archived should be better design, i dislike how this is currently made. tasks should be a
> table. should be able to sort by matter, date, and all information. do deep dive into clickup
> functionality and how it looks, and go from there. we have verbose table functionality we should
> attempt to use.

Nine asks. Section 2 is the deep dive the last one calls for; sections 3 to 9 answer the rest, in
the order a reader meets them on the screen.

## 2. What ClickUp does, and which of it a legal task list needs

ClickUp is a general work-management product. Its task record and its list view are the reference
the owner named, so this is what they hold and what each part is for, judged against a firm's work.

**The task record.** A title; a rich-text description; a status drawn from a per-list status set
(To Do, In Progress, Complete by default; a workspace may define its own, with a colour each); one
or more assignees; watchers, who receive every update without being assigned; a priority (Urgent,
High, Normal, Low, with a flag glyph in a colour); start and due dates, each optionally with a time,
in the workspace's zone; time estimate and time tracked; tags; custom fields; checklists (named
lists of items, each item tickable and assignable, with nesting one level deep); subtasks (full
tasks nested under the parent, with their own everything); dependencies (waiting on, blocking);
relationships to other tasks; attachments; a comment thread with mentions; and an activity log.

**The list view.** A table with one row per task, grouped by status by default (collapsible bands,
each a status), with the columns the workspace chose from the record's fields: name, assignee
avatars, due date, priority flag, and any custom field. Sorting is by any column; filtering is a
filter bar over any field; column visibility, order and width are the reader's and persist. A
**Closed** toggle in the view bar adds completed tasks, which are otherwise hidden. A task's status
and assignees are changeable in place, from the row: click the status chip and pick another, click
the assignee avatars and add or remove. Double-click opens the task in a panel over the list.

**What the record needs from this, and what it does not.**

| ClickUp has                             | Here                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title, description                      | Kept, and called that. Section 3.                                                                                                                                                                                                                                                                 |
| Several assignees                       | Adopted, as ROLES rather than a flat list. Section 5.                                                                                                                                                                                                                                             |
| Watchers                                | Adopted, as one of the roles.                                                                                                                                                                                                                                                                     |
| Status set, per list, with colours      | The four rungs stay closed and platform-wide (flag T3 is unchanged: firm statuses arrive with the board). Changeable in place from the row, which is the part that matters. Section 7.                                                                                                             |
| Priority with a flag glyph              | The four priorities stay; the row shows Urgent and High as badges and the rest as words.                                                                                                                                                                                                          |
| Due date with a time, workspace zone    | Due date, time and ZONE, on the record and on screen. A workspace zone is wrong for a firm with two offices. Section 4.                                                                                                                                                                           |
| Start date                              | Not adopted. A start date on a task is a planning field nobody at a firm fills in; the day work starts is the day somebody moves it to In Progress, which the audit log already records.                                                                                                           |
| Time estimate and time tracked          | Time tracked already rides the row from the time entries that name the task. An estimate stays refused (the scope study's reasoning: an estimate the product compares against actuals is a report, and reports have a home).                                                                       |
| Checklists                              | Adopted, flat. Section 6. Not assignable per line and not nested: an assignable, nested line is a subtask wearing a checkbox.                                                                                                                                                                     |
| Subtasks                                | Still refused, on the design's reasoning: rollup completion, depth limits and a recursive read. The checklist is the part people actually use.                                                                                                                                                    |
| Dependencies                            | Already here as one predecessor, advisory.                                                                                                                                                                                                                                                        |
| Tags, custom fields                     | Deferred; `custom_field.target` widening is the cheap route when wanted.                                                                                                                                                                                                                          |
| Comments                                | Deferred (flag T4, unchanged).                                                                                                                                                                                                                                                                    |
| Attachments                             | Already here; the tab is fixed. Section 8.                                                                                                                                                                                                                                                        |
| List view: a table, sort and filter any | Adopted, on the platform's one table. Section 7.                                                                                                                                                                                                                                                  |
| Group by status                         | Not adopted yet. The grid has row groups; a grouped view is a follow-on once the table has been used flat.                                                                                                                                                                                        |
| Closed toggle                           | Adopted, as two switches in the table's own footer: done and archived are two questions here. Section 7.                                                                                                                                                                                          |
| In-place status and assignee change     | Status: adopted, from the row. Assignees: from the window, because the people are four seats with a permission split, and a row control that had to explain that would be a window in a cell.                                                                                                     |
| Column visibility, order, width persist | The grid has all three; persistence is the grid's own concern and lands for every table at once.                                                                                                                                                                                                  |

## 3. Title and Description

The two fields are called **Title** and **Description**, everywhere: the window, the print sheet,
the user guide. "What to do" and "Detail" were invented names for the two fields every task product
calls the same thing, and a name a reader has to translate costs them something on every task. The
API field stays `body`, because a wire contract is not a label.

## 4. The due moment carries its zone, on screen

The record always required a zone with a date, and the window used to fill in the reader's own
silently. That is how a task due "2 pm" for the Boston office came to be stored as 2 pm Reno by
whoever in Reno typed it. The window now shows **Time Zone** as a field beside the time, defaulted
to the reader's own and changeable through the same picker the calendar's forms use (the reader's
zone and the task's existing zone offered first, then every zone the runtime can resolve). Wherever
a due time is read — the window, the table's Due cell, the print sheet — the zone reads beside it as
a shortcode worked out on the task's own day (PST in January, PDT in July), with the full name on
hover.

**On combining tasks with the calendar.** The owner asked that this be considered. The answer is
that a task with a due date is already on the calendar: the federated timeline reads `matter_task`
as a declared source, so a dated task on a matter appears on that matter's calendar and on the
firm's, beside the events and deadlines, and "on my calendar" includes the tasks I am on. What is
deliberately not done is making a task a calendar event. A task has people and a completion state,
which an event does not; an event has a continuance discipline and an external reality (a court
knows a hearing exists), which a task does not. Folding one into the other would import the wrong
rules in both directions; the tasks design says why at length. What the owner may want beyond this
is a matterless task on the firm calendar (today the timeline anchors on the matter, so the firm's
own work is absent from it) and reminders as a task becomes due, which wait on the notifications
comparison sweep. Both are named as next steps rather than built here.

## 5. The people on a task: four roles

A task used to carry one name. It now carries a list, one row per person per task, each in one of
four roles:

- **Responsible** — answers for the work getting done. The partner on the file, usually.
- **Assigned** — does the work. One or several.
- **Reviewer** — checks the work before it counts as done. The attorney reviewing a paralegal's
  draft.
- **Watcher** — hears when the task moves, and owes nothing.

The owner named the first, second and fourth and said "perhaps there are others as well"; Reviewer
is the one a law firm's work has and a general product does not put a name to, and it is the one
that makes "done" mean something on a task somebody else drafted. The vocabulary is closed and held
by a CHECK, so a fifth role is a reviewed migration.

**One role per person per task.** Somebody who both does the work and reviews it is somebody doing
the work; two rows would put them on a list twice. The unique index holds it.

**A role is not a permission and not a gate.** Nothing about who is on a task changes who may move
it or finish it. What a role decides is who is told and whose list the task is on: "my tasks" is
every task I am on, watchers included, because a watcher asked to see their tasks means the ones
they are watching too.

**The permission split is on the difference.** The assign permission governs naming another member
in a work role (responsible, assigned, reviewer) or taking them out of one. A member without it may
still take a task themselves, and may add and remove watchers, because watching is a subscription
rather than an obligation. The service refuses on the diff it is asked to make, so re-sending the
current list is never a refusal, and the route needs no second permission.

**Notification.** Everybody who joins a task is told, in the role they joined in, and everybody whose
role moves is told; nobody is told they left, and the actor is never told about themselves. The four
existing topics carry it; the payload gains the role and the card says "You are watching it" rather
than "Assigned to you" to a watcher.

**Visibility.** A task on no matter is private to the people on it and whoever created it, in every
role: adding a colleague as a watcher on the firm's own work is what lets them see it.

**The migration.** Every existing assignee became an `assigned` participant, and the one-name column
was emptied and retired where it stands (a column on a parent table is not dropped). Nothing reads
it and nothing writes it.

## 6. The checklist inside a task

Flat lines, in order, each tickable. A line has a title and a tick (who and when), and nothing else:
no people, no date, no priority, no documents, no time. Ticking every line completes nothing — the
task's rung is a fact somebody moves — which is the whole distinction from a subtask tree.

It is **live**: ticking, adding, renaming and removing are each their own write the moment they
happen, in the window's reading mode as much as its editing mode, because a checklist that had to be
Saved is a checklist nobody ticks. On a task that does not exist yet the lines are held in the
window and written with the task, in the same batch, so the draft reads exactly as the record will.
Every checklist write stamps the task as changed, so the change feed reports it and a mirror sees a
ticked line.

The table shows the checklist's progress ("2 of 5") as a column that starts hidden.

## 7. The table

The list is `DataTable.Grid`, the platform's one table, on both screens. What that buys, without a
line of this surface's own code: click a heading to sort, right-click it for its filter, hide and
show and reorder and pin and resize columns, double-click or Enter to open a row, the counts strip
under the rows with its way back to everything.

**The column model** (`apps/web/src/lib/matters/task-columns.ts`) declares every fact a row can
answer. Visible at first: Title (anchored), Matter (on the firm-wide list only), Status, Due,
Priority, Responsible, Assigned. Hidden until asked for: Reviewer, Watcher, Checklist, Attachments,
Time Logged, Created By, Created, Done On, Archived On. The rung and priority columns offer the whole
vocabulary to their filters; the people columns offer the whole roster. The description is the row's
second line, never a column.

**The opening sort is due date ascending**, and the grid puts empty values last in either direction,
so the undated tasks sit under the dated ones exactly as the server orders them.

**Status is a control in the row.** The cell is a menu of the four rungs with the current one
marked, and picking one is the same write the window's action bar makes. Done and reopen, in
particular, no longer need the window.

**Done and archived are two switches in the table's footer.** The counts strip already says how much
of the record is on screen; the two switches that add the closed work to it live there, because what
they change is what the count is of. They widen the list and are undone by their own switch, so
neither is a filter and neither draws the clear control. This replaces the two ghost buttons under
the list the owner disliked.

**Search is the server's** and runs over the whole record; the column filters are the table's and
run over what has been loaded. The Load More control in the footer brings the rest of the record
into reach of the filters, which is the same honest limit the docket has.

## 8. The Attachments tab

Two corrections to `RecordAttachments`, the one component every record's attachments tab is: the
attach sources (the matter's documents, and upload where a record takes one) sit at the TOP of the
pane, above what is already attached, and the document picker's list is a screen tall rather than
one row. The owner saw one item at a time because the list was capped at a height that showed one
item. Every record window inherits both, which is the point of the one component.

## 9. Editing after creation

Everything on a task is changeable after it exists, and each change has one home:

| Change                              | Where                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| Title, description, due, priority   | The window: Edit, change, Save                                     |
| The people, in any role             | The window: Edit, the four seats, Save                             |
| The rung                            | The row's Status cell, or the window's action bar                  |
| A checklist line                    | The window, live, in either mode                                   |
| Attachments                         | The window's Attachments tab, live                                 |
| Archive, put back, delete           | The window's action bar                                            |

The window has carried Edit since 2026-09-14; what the owner met was the deployed site before that
change had reached it. This design does not change the window's shape; it adds the seats, the zone
and the checklist to it.

## 10. What is not built here, and where each waits

- **A board, and firm-defined statuses** (T3). The grid's row grouping is the first step toward a
  grouped list; a board is a view over whatever the statuses are.
- **Comments** (T4).
- **The firm's own work on the firm calendar**, and **due-soon and overdue reminders** (section 4).
- **Persisting a reader's column choices**, which the grid owns for every table at once.
- **Reordering checklist lines by drag**; the API takes a position, the window does not yet offer
  one.

## 11. Owner flags touched

- **T5** — a flat checklist inside a task: **yes**, built as section 6 describes.
- **Multiple assignees** — the scope study's "keep the one-name column" is reversed by the owner's
  brief; built as section 5 describes, with the roles the owner named plus Reviewer.
- **T3, T4** — unchanged, still open.
