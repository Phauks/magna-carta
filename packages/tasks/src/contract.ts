import { z } from "zod";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  MAX_TASK_ASSIGNEES,
  MAX_TASK_BODY_LENGTH,
  MAX_TASK_CHECKLIST_ITEM_LENGTH,
  MAX_TASK_LINK_LABEL_LENGTH,
  MAX_TASK_LINK_URL_LENGTH,
  MAX_TASK_LIST_NAME_LENGTH,
  MAX_TASK_LIST_STATUSES,
  MAX_TASK_LOCATION_LENGTH,
  MAX_TASK_STATUS_NAME_LENGTH,
  MAX_TASK_TEAM_MEMBERS,
  MAX_TASK_TEAM_NAME_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  MAX_TASK_WATCHERS,
  TASK_PRIORITIES,
  TASK_RUNGS,
  TASK_STATUS_COLOURS,
} from "./types.ts";

// The task subsystem's contract: what its API accepts in a request body and returns in a response,
// as plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which the
// contract emitter reads as the component's name, so the route modules in apps/api-worker declare
// routes over these without restating a field. Path and query parameters stay with the routes:
// they are addressing, not domain shape. The rule is in docs/conventions/api.md (_Where a contract
// shape lives_).

const CIVIL_DATE = CIVIL_DATE_PATTERN;
const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

// ---- a task ----

// When a task is due, as a caller supplies it. All three are optional together — a task with no due
// date is ordinary — and the shape rules are enforced in the domain rather than here: a time needs a
// date, and a date needs the zone it is read in, because a task due "Friday" falls at two different
// moments in Reno and Boston.
const dueFields = {
  dueOn: z.string().regex(CIVIL_DATE).nullable().optional(),
  dueAtTime: z.string().regex(WALL_CLOCK_TIME).nullable().optional(),
  timeZone: z.string().min(1).max(120).nullable().optional(),
};

const taskContentFields = {
  title: z.string().min(1).max(MAX_TASK_TITLE_LENGTH),
  body: z.string().max(MAX_TASK_BODY_LENGTH).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  blockedByTaskId: identifierField("matterTask").nullable().optional(),
  triggerEventId: identifierField("matterEvent").nullable().optional(),
  deadlineId: identifierField("matterDeadline").nullable().optional(),
  ...dueFields,
  // Left out on an edit, each keeps what the task has; null clears it.
  startsOn: z.string().regex(CIVIL_DATE).nullable().optional(),
  location: z.string().max(MAX_TASK_LOCATION_LENGTH).nullable().optional(),
};

// One assignee: a person or a team, never both. A team assigned is its members at the time they
// look, so somebody joining the team picks up its work without anybody reassigning it.
export const TaskAssigneeInput = z
  .union([
    z.object({ userId: identifierField("user") }),
    z.object({ teamId: identifierField("taskTeam") }),
  ])
  .meta({ id: "MatterTaskAssigneeInput" });

export const CreateTaskRequest = z
  .object({
    // Explicitly nullable rather than omitted: a task on no matter is a decision the caller makes,
    // not a field they forgot.
    matterId: identifierField("matter").nullable(),
    assigneeUserId: identifierField("user").nullable().optional(),
    // Which list, and where on it. Left out, the firm's default list at its first status. A
    // sub-task takes its parent's list and matter whatever is sent here.
    listId: identifierField("taskList").nullable().optional(),
    statusId: identifierField("taskListStatus").nullable().optional(),
    parentTaskId: identifierField("matterTask").nullable().optional(),
    // Every assignee, people and teams, in order. When present it replaces assigneeUserId.
    assignees: z.array(TaskAssigneeInput).max(MAX_TASK_ASSIGNEES).optional(),
    watcherUserIds: z.array(identifierField("user")).max(MAX_TASK_WATCHERS).optional(),
    ...taskContentFields,
  })
  .meta({ id: "CreateMatterTaskRequest" });

export const EditTaskRequest = z.object(taskContentFields).meta({ id: "EditMatterTaskRequest" });

export const TaskDocument = z
  .object({
    id: z.string(),
    fileId: z.string(),
    fileName: z.string(),
    contentType: z.string().nullable(),
    linkedAt: z.string(),
    linkedBy: z.string().nullable(),
  })
  .meta({ id: "MatterTaskDocument" });

export const TaskDetail = z
  .object({
    id: z.string(),
    // Null on a task that belongs to no client file.
    matterId: z.string().nullable(),
    title: z.string(),
    body: z.string().nullable(),
    // Null on a task nobody has picked up, which is a real state rather than a defect.
    assigneeUserId: z.string().nullable(),
    createdBy: z.string(),
    priority: z.enum(TASK_PRIORITIES),
    dueOn: z.string().nullable(),
    dueAtTime: z.string().nullable(),
    timeZone: z.string().nullable(),
    // WHERE THE TASK STANDS, as the one vocabulary a reader has. The two columns behind it are the
    // platform's problem and never a consumer's: nothing outside the server needs to know that
    // three rungs live in one column and the fourth in another.
    rung: z.enum(TASK_RUNGS),
    completedAt: z.string().nullable(),
    completedBy: z.string().nullable(),
    // PUT AWAY, KEPT. Orthogonal to the rung — a task is archived FROM wherever it stood, and
    // unarchiving puts it back there. The reason is optional and usually absent.
    archivedAt: z.string().nullable(),
    archivedBy: z.string().nullable(),
    archiveReason: z.string().nullable(),
    // The one task this one waits on, where there is one. It GATES NOTHING: a blocked task may still
    // be completed, because a firm's real sequence has exceptions constantly.
    blockedByTaskId: z.string().nullable(),
    triggerEventId: z.string().nullable(),
    deadlineId: z.string().nullable(),
    // Which of the firm's lists the task is on, and where it stands on that list's own statuses.
    // The status is the firm's word for the work; whether it is FINISHED is `completedAt`, kept
    // apart so finishing a task leaves its status where it stood.
    listId: z.string().nullable(),
    statusId: z.string().nullable(),
    // The task this one is a sub-task of. A sub-task shares its parent's list and matter.
    parentTaskId: z.string().nullable(),
    startsOn: z.string().nullable(),
    // Where the work happens: a room, an address, or a meeting link.
    location: z.string().nullable(),
    // Everyone the work is assigned to, people and teams, in the order they were named.
    assignees: z.array(
      z
        .object({ id: z.string(), userId: z.string().nullable(), teamId: z.string().nullable() })
        .meta({ id: "MatterTaskAssignee" }),
    ),
    // People kept informed of the work without doing it.
    watcherUserIds: z.array(z.string()),
    checklist: z.array(
      z
        .object({
          id: z.string(),
          text: z.string(),
          doneAt: z.string().nullable(),
          doneBy: z.string().nullable(),
        })
        .meta({ id: "MatterTaskChecklistItem" }),
    ),
    links: z.array(
      z
        .object({ id: z.string(), url: z.string(), label: z.string().nullable() })
        .meta({ id: "MatterTaskLink" }),
    ),
    documents: z.array(TaskDocument),
    // How long this task has actually taken, from the time entries that name it. Minutes only —
    // what a task COST is a billing question with a different audience and a different permission.
    // The scope rides WITH the numbers rather than once per page on purpose: the same two totals
    // mean "what this task cost the firm" under `firm` and "what I have put into it" under `own`,
    // and a consumer must not be able to render one without the other.
    // Who touched it last, and null on a row nothing has edited since it was written. A mirror
    // reads this to tell its OWN writes from a person's; without it a two-way sync pushes back
    // everything it just pulled and the two sides oscillate.
    updatedBy: z.string().nullable(),
    // Where else this task is written down. Empty on nearly every task: the platform integrates
    // with nothing and ships no adapter, so a row here exists only because an addon put it there.
    externalLinks: z.array(
      z
        .object({
          id: z.string(),
          system: z.string(),
          externalId: z.string(),
          externalUrl: z.string().nullable(),
          remoteRevision: z.string().nullable(),
          lastSyncedAt: z.string().nullable(),
        })
        .meta({ id: "MatterTaskExternalLink" }),
    ),
    timeLogged: z
      .object({
        billableMinutes: z.number().int(),
        nonBillableMinutes: z.number().int(),
        entryCount: z.number().int(),
        scope: z.enum(["firm", "own"]),
      })
      .meta({ id: "MatterTaskTimeLogged" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "MatterTaskDetail" });

// ---- lists, statuses, teams, and a task's own parts ----

export const TaskListStatus = z
  .object({
    id: z.string(),
    name: z.string(),
    colour: z.enum(TASK_STATUS_COLOURS),
    position: z.number().int(),
    // The statuses a task on this one may move to. The flow is the firm's; an empty list means the
    // status is where work on this list ends up.
    nextStatusIds: z.array(z.string()),
  })
  .meta({ id: "TaskListStatus" });

export const TaskList = z
  .object({
    id: z.string(),
    name: z.string(),
    // The list a task lands on when nobody names one. Exactly one list is the default.
    isDefault: z.boolean(),
    // Open tasks on it, top level and sub-tasks alike, for the count beside its name.
    openCount: z.number().int(),
    statuses: z.array(TaskListStatus),
  })
  .meta({ id: "TaskList" });

export const TaskListCollection = z
  .object({ data: z.array(TaskList) })
  .meta({ id: "TaskListCollection" });

export const TaskTeam = z
  .object({ id: z.string(), name: z.string(), memberUserIds: z.array(z.string()) })
  .meta({ id: "TaskTeam" });

export const TaskTeamCollection = z
  .object({ data: z.array(TaskTeam) })
  .meta({ id: "TaskTeamCollection" });

export const TaskSubtaskTrees = z
  .object({ data: z.array(TaskDetail) })
  .meta({ id: "MatterTaskSubtaskTrees" });

export const TaskListNameRequest = z
  .object({ name: z.string().min(1).max(MAX_TASK_LIST_NAME_LENGTH) })
  .meta({ id: "TaskListNameRequest" });

export const RetireTaskListRequest = z
  .object({ moveTasksToListId: identifierField("taskList") })
  .meta({ id: "RetireTaskListRequest" });

export const AddTaskListStatusRequest = z
  .object({
    name: z.string().min(1).max(MAX_TASK_STATUS_NAME_LENGTH),
    colour: z.enum(TASK_STATUS_COLOURS),
  })
  .meta({ id: "AddTaskListStatusRequest" });

export const UpdateTaskListStatusRequest = z
  .object({
    name: z.string().min(1).max(MAX_TASK_STATUS_NAME_LENGTH),
    colour: z.enum(TASK_STATUS_COLOURS),
    position: z.number().int().min(0).max(MAX_TASK_LIST_STATUSES),
  })
  .meta({ id: "UpdateTaskListStatusRequest" });

export const TaskStatusFlowRequest = z
  .object({ toStatusIds: z.array(identifierField("taskListStatus")).max(MAX_TASK_LIST_STATUSES) })
  .meta({ id: "TaskStatusFlowRequest" });

export const TaskTeamRequest = z
  .object({
    name: z.string().min(1).max(MAX_TASK_TEAM_NAME_LENGTH),
    memberUserIds: z.array(identifierField("user")).max(MAX_TASK_TEAM_MEMBERS),
  })
  .meta({ id: "TaskTeamRequest" });

export const MoveTaskToStatusRequest = z
  .object({ statusId: identifierField("taskListStatus") })
  .meta({ id: "MoveMatterTaskToStatusRequest" });

export const MoveTaskToListRequest = z
  .object({ listId: identifierField("taskList") })
  .meta({ id: "MoveMatterTaskToListRequest" });

export const TaskCompletionRequest = z
  .object({ completed: z.boolean() })
  .meta({ id: "SetMatterTaskCompletionRequest" });

export const TaskAssigneesRequest = z
  .object({
    assignees: z.array(TaskAssigneeInput).max(MAX_TASK_ASSIGNEES),
  })
  .meta({ id: "SetMatterTaskAssigneesRequest" });

export const TaskWatchersRequest = z
  .object({ userIds: z.array(identifierField("user")).max(MAX_TASK_WATCHERS) })
  .meta({ id: "SetMatterTaskWatchersRequest" });

export const AddTaskChecklistItemRequest = z
  .object({ text: z.string().min(1).max(MAX_TASK_CHECKLIST_ITEM_LENGTH) })
  .meta({ id: "AddMatterTaskChecklistItemRequest" });

export const UpdateTaskChecklistItemRequest = z
  .object({
    text: z.string().min(1).max(MAX_TASK_CHECKLIST_ITEM_LENGTH).optional(),
    done: z.boolean().optional(),
  })
  .meta({ id: "UpdateMatterTaskChecklistItemRequest" });

export const AddTaskLinkRequest = z
  .object({
    url: z.string().min(1).max(MAX_TASK_LINK_URL_LENGTH),
    label: z.string().max(MAX_TASK_LINK_LABEL_LENGTH).nullable().optional(),
  })
  .meta({ id: "AddMatterTaskLinkRequest" });
