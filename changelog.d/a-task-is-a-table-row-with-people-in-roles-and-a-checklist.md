---
category: Changed
audience: public
---

**Tasks: the list is the platform's one table, a task carries its people in four roles and a flat checklist, a due time carries its zone on screen, and the attachments picker is usable.** The owner's 2026-09-16 review, answered in one change; the design and the ClickUp comparison it was judged against are in `docs/specs/2026-09-16-tasks-table-people-and-checklist-design.md`.

`matter_task_participant` (one row per person per task; `role` in `responsible | assigned | reviewer | watcher` by CHECK; unique on task and person) replaces `matter_task.assignee_user_id`, which the migration copies across as `assigned` and retires where it stands. `matter_task_checklist_item` holds the flat lines. The visibility fragment for a matterless task reads the participant table in every role. `setMatterTaskParticipants` replaces reassignment and refuses on the DIFFERENCE it is asked to make: naming another member in a work role, or removing them from one, needs `tasks:assign`; taking a task oneself and adding or removing watchers does not. The service takes the route's answer as `canAssignOthers`. Three checklist writes, each touching the task's `updated_at` so the change feed sees them. The calendar's `matterTask` source filters "my calendar" through the participant table and names its actor as the first responsible or assigned member. `assigneeUserId` leaves the wire; `participants`, `checklist`, `matterTitle` and `matterNumber` join it; `GET /api/v1/tasks/{taskId}` answers a deep link. The list filter is `participantUserId`.

`task-list.svelte` is rebuilt on `DataTable.Grid` with a column model in `task-columns.ts`; the Status cell is a menu that moves the rung in place; done and archived work are two switches in the grid's footer. `RecordAttachments` puts its sources above the list and gives the picker a screen of height (it was capped at 64 pixels, one row). The window relabels the two fields Title and Description and shows the Time Zone beside the time.

## Public

**Tasks are a table.** Every task list is now the same table the rest of Magna Carta uses. Click a column heading to sort by it, right-click one to filter it, and turn on the columns you want from the same menu: the reviewers and watchers, the checklist's progress, the time logged, who created it and when, and on the firm-wide list the matter. Double-click a row to open the task. The description reads as a second line under each row rather than being cut short in a column.

**Change a task's status from the row.** The Status cell is a control: pick To Do, In Progress, On Hold or Done without opening the task.

**Show done and show archived** are two switches in the strip under the table, beside the count of what is on screen, in place of the two buttons that used to float under the list.

**A task can have several people on it, each in a role.** Responsible answers for the work, Assigned does it, Reviewer checks it before it counts, and Watcher just hears when it moves. Open a task, press Edit, and fill the four seats; everybody you add is told, in the role you added them in. If your role does not include assigning work to others, you can still take a task yourself and add anyone as a watcher. "My tasks" includes the tasks you are watching.

**A task has a checklist.** Add lines, tick them off, rename or remove them, straight from the task, without pressing Save; the table shows how far a checklist has come. Ticking every line does not finish the task: that is still yours to say.

**A due time shows its time zone**, beside the time, everywhere the time is shown, and you choose the zone when you set the time rather than it being assumed from where you happen to be sitting.

**The fields are called Title and Description.**

**Attaching a document from the matter is at the top of the Attachments tab**, and the picker shows a full list rather than one document at a time.

**A link to a task opens it.** A notification or an activity entry that names a task opens that task in its window, wherever it sits in the list.
