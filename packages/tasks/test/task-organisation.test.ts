/*
 * How a firm organises its task work, and what a task carries besides its words: lists with their
 * own statuses and flow, teams, several assignees, watchers, sub-tasks, a checklist and links. Each
 * case pins one rule the owner ruled on 2026-11-09 or one the write paths hold so the data stays
 * whole.
 */
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterTaskId, TaskListStatusId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  addChecklistItem,
  addTaskLink,
  addTaskListStatus,
  createTaskList,
  createTaskTeam,
  moveTaskToList,
  moveTaskToStatus,
  removeTaskListStatus,
  retireTaskList,
  setTaskAssignees,
  setTaskStatusFlow,
  setTaskWatchers,
  updateChecklistItem,
} from "../src/organisation-service.ts";
import {
  readTaskAssignees,
  readTaskChecklistItems,
  readTaskLinks,
  readTaskListStatuses,
  readTaskLists,
} from "../src/organisation-statements.ts";
import { createMatterTask, deleteMatterTask, setMatterTaskCompleted } from "../src/task-service.ts";
import { readMatterTask, selectMyTasksStatement } from "../src/task-statements.ts";
import { DEFAULT_TASK_LIST_ID, MAX_SUBTASK_DEPTH } from "../src/types.ts";
import {
  ACTOR,
  COLLEAGUE,
  MATTER,
  OTHER_MATTER,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  visibility,
} from "./support.ts";

function setup(): BatchDatabase {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database.database;
}

async function task(
  database: BatchDatabase,
  input: Partial<Parameters<typeof createMatterTask>[1]> = {},
): Promise<MatterTaskId> {
  const created = await createMatterTask(
    database,
    { matterId: MATTER, title: "Draft the responses", ...input },
    options,
  );
  await commit(database, created.effect);
  return created.taskId;
}

async function read(database: BatchDatabase, taskId: MatterTaskId) {
  const row = await readMatterTask(database, taskId, visibility, ACTOR);
  if (row === undefined) throw new Error("task not found");
  return row;
}

describe("lists and statuses", () => {
  it("puts a new task on the default list at its first status", async () => {
    const database = setup();
    const taskId = await task(database);
    const row = await read(database, taskId);
    const [first] = await readTaskListStatuses(database, [DEFAULT_TASK_LIST_ID as never]);
    expect(row.list_id).toBe(DEFAULT_TASK_LIST_ID);
    expect(row.status_id).toBe(first?.id);
  });

  it("starts a new list with two statuses and the move each way", async () => {
    const database = setup();
    const created = await createTaskList(database, { name: "Partners" }, options);
    await commit(database, created.effect);
    const statuses = await readTaskListStatuses(database, [created.listId]);
    expect(statuses.map((status) => status.name)).toEqual(["To Do", "In Progress"]);
    const taskId = await task(database, { listId: created.listId });
    await commit(
      database,
      (await moveTaskToStatus(database, taskId, statuses[1]?.id as TaskListStatusId, options))
        .effect,
    );
    expect((await read(database, taskId)).status_id).toBe(statuses[1]?.id);
  });

  it("refuses a move the list's flow does not hold, and allows it once the flow does", async () => {
    const database = setup();
    const created = await createTaskList(database, { name: "Litigation" }, options);
    await commit(database, created.effect);
    const added = await addTaskListStatus(
      database,
      created.listId,
      { name: "Client Review", colour: "orange" },
      options,
    );
    await commit(database, added.effect);
    const taskId = await task(database, { listId: created.listId });
    await expect(moveTaskToStatus(database, taskId, added.statusId, options)).rejects.toMatchObject(
      { code: "task-status-move-not-in-flow" },
    );
    const [toDo, inProgress] = await readTaskListStatuses(database, [created.listId]);
    await commit(
      database,
      (
        await setTaskStatusFlow(
          database,
          toDo?.id as TaskListStatusId,
          { toStatusIds: [inProgress?.id as TaskListStatusId, added.statusId] },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (await moveTaskToStatus(database, taskId, added.statusId, options)).effect,
    );
    expect((await read(database, taskId)).status_id).toBe(added.statusId);
  });

  it("completes from any status and reopens to the same one, whatever the flow says", async () => {
    const database = setup();
    const taskId = await task(database);
    const before = (await read(database, taskId)).status_id;
    await commit(database, (await setMatterTaskCompleted(database, taskId, true, options)).effect);
    expect((await read(database, taskId)).state).toBe("done");
    await commit(database, (await setMatterTaskCompleted(database, taskId, false, options)).effect);
    const reopened = await read(database, taskId);
    expect(reopened.state).toBe("open");
    expect(reopened.status_id).toBe(before);
  });

  it("will not remove a status a task stands on, or retire the default list", async () => {
    const database = setup();
    const taskId = await task(database);
    const row = await read(database, taskId);
    await expect(
      removeTaskListStatus(database, row.status_id as TaskListStatusId, options),
    ).rejects.toMatchObject({ code: "task-status-in-use" });
    const other = await createTaskList(database, { name: "Assignments" }, options);
    await commit(database, other.effect);
    await expect(
      retireTaskList(
        database,
        DEFAULT_TASK_LIST_ID as never,
        { moveTasksToListId: other.listId },
        options,
      ),
    ).rejects.toMatchObject({ code: "task-list-is-default" });
  });

  it("moves every task on a retired list to the list named, at its first status", async () => {
    const database = setup();
    const retiring = await createTaskList(database, { name: "Old" }, options);
    await commit(database, retiring.effect);
    const taskId = await task(database, { listId: retiring.listId });
    await commit(
      database,
      (
        await retireTaskList(
          database,
          retiring.listId,
          { moveTasksToListId: DEFAULT_TASK_LIST_ID as never },
          options,
        )
      ).effect,
    );
    expect((await read(database, taskId)).list_id).toBe(DEFAULT_TASK_LIST_ID);
    expect((await readTaskLists(database)).map((list) => list.name)).not.toContain("Old");
  });
});

describe("assignees, teams and watchers", () => {
  it("assigns people and teams together, keeping the first person on the task row", async () => {
    const database = setup();
    const team = await createTaskTeam(
      database,
      { name: "Litigation Team", memberUserIds: [COLLEAGUE] },
      options,
    );
    await commit(database, team.effect);
    const taskId = await task(database);
    const set = await setTaskAssignees(
      database,
      taskId,
      [{ teamId: team.teamId }, { userId: ACTOR }],
      options,
    );
    await commit(database, set.effect);
    const rows = await readTaskAssignees(database, [taskId]);
    expect(rows.map((row) => row.user_id ?? row.team_id)).toEqual([ACTOR, team.teamId]);
    expect((await read(database, taskId)).assignee_user_id).toBe(ACTOR);
  });

  it("counts a task assigned to your team as yours in Me Mode, and a watched one as watched", async () => {
    const database = setup();
    const team = await createTaskTeam(
      database,
      { name: "Litigation Team", memberUserIds: [COLLEAGUE] },
      options,
    );
    await commit(database, team.effect);
    const teamTask = await task(database, { assignees: [{ teamId: team.teamId }] });
    const watched = await task(database, { title: "Watched", watcherUserIds: [COLLEAGUE] });
    await task(database, { title: "Somebody else's", assigneeUserId: ACTOR });

    const assigned = await selectMyTasksStatement(database, {
      limit: 50,
      visibility,
      viewerUserId: COLLEAGUE,
      filters: { assignedToUserId: COLLEAGUE },
    }).all<{ id: MatterTaskId }>();
    expect(assigned.results.map((row) => row.id)).toEqual([teamTask]);

    const watching = await selectMyTasksStatement(database, {
      limit: 50,
      visibility,
      viewerUserId: COLLEAGUE,
      filters: { watchedByUserId: COLLEAGUE },
    }).all<{ id: MatterTaskId }>();
    expect(watching.results.map((row) => row.id)).toEqual([watched]);

    const both = await selectMyTasksStatement(database, {
      limit: 50,
      visibility,
      viewerUserId: COLLEAGUE,
      filters: { assignedToUserId: COLLEAGUE, watchedByUserId: COLLEAGUE },
    }).all<{ id: MatterTaskId }>();
    expect(both.results.map((row) => row.id).toSorted()).toEqual([teamTask, watched].toSorted());
  });

  it("tells each newly named person, but not the one doing the naming", async () => {
    const database = setup();
    const taskId = await task(database);
    const set = await setTaskAssignees(
      database,
      taskId,
      [{ userId: ACTOR }, { userId: COLLEAGUE }],
      options,
    );
    expect(set.effect.outboxMessages.map((message) => message.payload)).toEqual([
      expect.objectContaining({ assigneeUserId: COLLEAGUE }),
    ]);
  });

  it("refuses a watcher who is not an active member", async () => {
    const database = setup();
    const taskId = await task(database);
    await expect(
      setTaskWatchers(database, taskId, ["user_nobodyAtAll00" as never], options),
    ).rejects.toMatchObject({ code: "task-unknown-assignee" });
  });
});

describe("sub-tasks", () => {
  it("puts a sub-task on its parent's list and matter, whatever the caller passed", async () => {
    const database = setup();
    const parent = await task(database);
    const child = await task(database, { parentTaskId: parent, matterId: OTHER_MATTER });
    const row = await read(database, child);
    expect(row.parent_task_id).toBe(parent);
    expect(row.matter_id).toBe(MATTER);
    expect(row.list_id).toBe(DEFAULT_TASK_LIST_ID);
  });

  it("nests only as deep as allowed", async () => {
    const database = setup();
    let parent = await task(database);
    for (let depth = 1; depth <= MAX_SUBTASK_DEPTH; depth += 1) {
      parent = await task(database, { parentTaskId: parent, title: `Level ${String(depth)}` });
    }
    await expect(
      createMatterTask(
        database,
        { matterId: MATTER, title: "Too deep", parentTaskId: parent },
        options,
      ),
    ).rejects.toMatchObject({ code: "task-parent-too-deep" });
  });

  it("moves a task's whole tree when the task changes lists", async () => {
    const database = setup();
    const list = await createTaskList(database, { name: "Partners" }, options);
    await commit(database, list.effect);
    const parent = await task(database);
    const child = await task(database, { parentTaskId: parent });
    const grandchild = await task(database, { parentTaskId: child });
    await commit(database, (await moveTaskToList(database, parent, list.listId, options)).effect);
    for (const id of [parent, child, grandchild]) {
      expect((await read(database, id)).list_id).toBe(list.listId);
    }
    await expect(
      moveTaskToList(database, child, DEFAULT_TASK_LIST_ID as never, options),
    ).rejects.toMatchObject({ code: "task-list-unknown" });
  });

  it("lifts a deleted task's sub-tasks to where it stood rather than deleting them", async () => {
    const database = setup();
    const parent = await task(database);
    const middle = await task(database, { parentTaskId: parent });
    const child = await task(database, { parentTaskId: middle });
    await addChecklistItem(database, middle, { text: "One" }, options).then((added) =>
      commit(database, added.effect),
    );
    await commit(database, (await deleteMatterTask(database, middle, options)).effect);
    expect((await read(database, child)).parent_task_id).toBe(parent);
    expect(await readTaskChecklistItems(database, [middle])).toHaveLength(0);
  });
});

describe("start date, location, checklist and links", () => {
  it("refuses a start after the due date", async () => {
    const database = setup();
    await expect(
      createMatterTask(
        database,
        {
          matterId: MATTER,
          title: "Backwards",
          startsOn: "2026-11-20",
          dueOn: "2026-11-10",
          timeZone: "America/Los_Angeles",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "task-start-after-due" });
  });

  it("keeps a location and a start date", async () => {
    const database = setup();
    const taskId = await task(database, {
      startsOn: "2026-11-02",
      location: "https://meet.example.com/room",
    });
    const row = await read(database, taskId);
    expect(row.starts_on).toBe("2026-11-02");
    expect(row.location).toBe("https://meet.example.com/room");
  });

  it("ticks a checklist line and remembers who ticked it", async () => {
    const database = setup();
    const taskId = await task(database);
    const added = await addChecklistItem(
      database,
      taskId,
      { text: "Pull the definitions" },
      options,
    );
    await commit(database, added.effect);
    await commit(
      database,
      (await updateChecklistItem(database, added.itemId, { done: true }, options)).effect,
    );
    const [item] = await readTaskChecklistItems(database, [taskId]);
    expect(item?.done_by).toBe(ACTOR);
    expect(item?.done_at).not.toBeNull();
  });

  it("keeps web links and refuses any other kind of address", async () => {
    const database = setup();
    const taskId = await task(database);
    const added = await addTaskLink(
      database,
      taskId,
      { url: "https://court.example.gov/filing", label: "Filing page" },
      options,
    );
    await commit(database, added.effect);
    expect((await readTaskLinks(database, [taskId])).map((link) => link.label)).toEqual([
      "Filing page",
    ]);
    await expect(
      addTaskLink(database, taskId, { url: "javascript:alert(1)" }, options),
    ).rejects.toMatchObject({ code: "task-link-invalid" });
  });
});
