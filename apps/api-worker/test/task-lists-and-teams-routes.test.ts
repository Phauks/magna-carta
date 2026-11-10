import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's task lists, statuses and teams over HTTP, and the parts of a task that are rows of
// their own. The domain package pins the rules; what this pins is that the routes reach them, that
// a task read carries what was written, and that Me Mode narrows the list to the reader's work.

let firmId: FirmId;
let cookie: string;
let ownerUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Task Lists Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("task-lists-owner@example.com", {
    userName: "Task Lists Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Task Lists Owner", firmId);
  cookie = await signInForSessionCookie("task-lists-owner@example.com");
});

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      origin: "https://example.com",
      cookie,
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface TaskListBody {
  id: string;
  name: string;
  isDefault: boolean;
  statuses: { id: string; name: string; colour: string; nextStatusIds: string[] }[];
}

interface TaskBody {
  id: string;
  listId: string | null;
  statusId: string | null;
  parentTaskId: string | null;
  startsOn: string | null;
  location: string | null;
  dueOn?: string | null;
  completedAt: string | null;
  recurrence: {
    rule: string;
    mode: string;
    occurrenceOn: string;
    nextTaskId: string | null;
  } | null;
  assignees: { userId: string | null; teamId: string | null }[];
  watcherUserIds: string[];
  checklist: { id: string; text: string; doneAt: string | null }[];
  links: { id: string; url: string; label: string | null }[];
}

async function lists(): Promise<TaskListBody[]> {
  const response = await call("GET", "/api/v1/task-lists");
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: TaskListBody[] }).data;
}

async function tasks(query = ""): Promise<TaskBody[]> {
  const response = await call("GET", `/api/v1/tasks${query}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: TaskBody[] }).data;
}

async function createdId(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe("task lists, statuses and teams", () => {
  it("starts every firm on one default list with its three statuses", async () => {
    const [list, ...others] = await lists();
    expect(others).toEqual([]);
    expect(list?.isDefault).toBe(true);
    expect(list?.statuses.map((status) => status.name)).toEqual([
      "To Do",
      "In Progress",
      "On Hold",
    ]);
  });

  it("adds a list, a status of the firm's own, and the flow into it", async () => {
    const listId = await createdId(await call("POST", "/api/v1/task-lists", { name: "Partners" }));
    const statusId = await createdId(
      await call("POST", `/api/v1/task-lists/${listId}/statuses`, {
        name: "Awaiting Client",
        colour: "purple",
      }),
    );
    const partners = (await lists()).find((list) => list.id === listId);
    const toDo = partners?.statuses.find((status) => status.name === "To Do");
    expect(toDo).toBeDefined();
    const flow = await call("PUT", `/api/v1/task-list-statuses/${toDo!.id}/flow`, {
      toStatusIds: [statusId],
    });
    expect(flow.status).toBe(200);
    const after = (await lists()).find((list) => list.id === listId);
    expect(after?.statuses.find((status) => status.id === toDo!.id)?.nextStatusIds).toEqual([
      statusId,
    ]);
  });

  it("refuses a second live list with the same name", async () => {
    await createdId(await call("POST", "/api/v1/task-lists", { name: "Assignments" }));
    const again = await call("POST", "/api/v1/task-lists", { name: "assignments" });
    expect(again.status).toBe(409);
  });

  it("keeps a team with its members", async () => {
    const teamId = await createdId(
      await call("POST", "/api/v1/task-teams", {
        name: "Trial Team",
        memberUserIds: [ownerUserId],
      }),
    );
    const response = await call("GET", "/api/v1/task-teams");
    const teams = ((await response.json()) as { data: { id: string; memberUserIds: string[] }[] })
      .data;
    expect(teams.find((team) => team.id === teamId)?.memberUserIds).toEqual([ownerUserId]);
  });
});

describe("what a task carries", () => {
  it("writes and reads back start, location, assignees, watchers, checklist and links", async () => {
    const teamId = await createdId(
      await call("POST", "/api/v1/task-teams", { name: "Intake", memberUserIds: [ownerUserId] }),
    );
    const taskId = await createdId(
      await call("POST", "/api/v1/tasks", {
        matterId: null,
        title: "Prepare the board pack",
        startsOn: "2026-11-10",
        dueOn: "2026-11-12",
        timeZone: "America/Los_Angeles",
        location: "https://example.com/meeting",
        assignees: [{ userId: ownerUserId }, { teamId }],
        watcherUserIds: [ownerUserId],
      }),
    );
    await createdId(await call("POST", `/api/v1/tasks/${taskId}/checklist`, { text: "Agenda" }));
    await createdId(
      await call("POST", `/api/v1/tasks/${taskId}/links`, {
        url: "https://example.com/pack",
        label: "Pack",
      }),
    );
    const task = (await tasks()).find((row) => row.id === taskId);
    expect(task?.startsOn).toBe("2026-11-10");
    expect(task?.location).toBe("https://example.com/meeting");
    expect(task?.listId).not.toBeNull();
    expect(task?.statusId).not.toBeNull();
    expect(task?.assignees.map((assignee) => assignee.userId ?? assignee.teamId)).toEqual([
      ownerUserId,
      teamId,
    ]);
    expect(task?.watcherUserIds).toEqual([ownerUserId]);
    expect(task?.checklist.map((item) => item.text)).toEqual(["Agenda"]);
    expect(task?.links.map((link) => link.label)).toEqual(["Pack"]);
  });

  it("refuses a link that is not a web address", async () => {
    const taskId = await createdId(
      await call("POST", "/api/v1/tasks", { matterId: null, title: "Check the link rule" }),
    );
    const refused = await call("POST", `/api/v1/tasks/${taskId}/links`, {
      url: "javascript:alert(1)",
    });
    expect(refused.status).toBe(422);
  });

  it("completes and reopens without moving the status", async () => {
    const taskId = await createdId(
      await call("POST", "/api/v1/tasks", { matterId: null, title: "File the renewal" }),
    );
    const before = (await tasks()).find((row) => row.id === taskId);
    expect(
      (await call("PUT", `/api/v1/tasks/${taskId}/completion`, { completed: true })).status,
    ).toBe(200);
    const done = (await tasks("?completed=true")).find((row) => row.id === taskId);
    expect(done?.completedAt).not.toBeNull();
    expect(done?.statusId).toBe(before?.statusId);
    expect((await tasks("?completed=false")).some((row) => row.id === taskId)).toBe(false);
    expect(
      (await call("PUT", `/api/v1/tasks/${taskId}/completion`, { completed: false })).status,
    ).toBe(200);
    expect((await tasks("?completed=false")).some((row) => row.id === taskId)).toBe(true);
  });

  it("keeps a comment thread that only the author may reword or remove", async () => {
    const taskId = await createdId(
      await call("POST", "/api/v1/tasks", { matterId: null, title: "Renew the policy" }),
    );
    const commentId = await createdId(
      await call("POST", `/api/v1/tasks/${taskId}/comments`, {
        body: "Broker has the forms, @Task Lists Owner",
        mentionedUserIds: [ownerUserId],
      }),
    );
    expect(
      (await call("PUT", `/api/v1/task-comments/${commentId}`, { body: "Forms signed." })).status,
    ).toBe(200);
    const read = await call("GET", `/api/v1/tasks/${taskId}/comments`);
    expect(read.status).toBe(200);
    const [comment, ...rest] = (
      (await read.json()) as {
        data: { id: string; body: string; editedAt: string | null; mentionedUserIds: string[] }[];
      }
    ).data;
    expect(rest).toEqual([]);
    expect(comment?.body).toBe("Forms signed.");
    expect(comment?.editedAt).not.toBeNull();
    expect(comment?.mentionedUserIds).toEqual([]);
    expect((await call("DELETE", `/api/v1/task-comments/${commentId}`)).status).toBe(200);
    expect((await call("DELETE", `/api/v1/task-comments/${commentId}`)).status).toBe(404);
  });

  it("repeats a task, making the next copy when this one is completed", async () => {
    const taskId = await createdId(
      await call("POST", "/api/v1/tasks", {
        matterId: null,
        title: "Reconcile the trust account",
        dueOn: "2026-11-10",
        timeZone: "America/Los_Angeles",
      }),
    );
    expect(
      (await call("PUT", `/api/v1/tasks/${taskId}/recurrence`, { rule: "FREQ=BOGUS" })).status,
    ).toBe(422);
    expect(
      (await call("PUT", `/api/v1/tasks/${taskId}/recurrence`, { rule: "FREQ=MONTHLY" })).status,
    ).toBe(200);
    const repeating = (await tasks()).find((row) => row.id === taskId);
    expect(repeating?.recurrence).toEqual({
      rule: "FREQ=MONTHLY",
      mode: "completed",
      occurrenceOn: "2026-11-10",
      nextTaskId: null,
    });
    expect(
      (await call("PUT", `/api/v1/tasks/${taskId}/completion`, { completed: true })).status,
    ).toBe(200);
    const done = (await tasks("?completed=true")).find((row) => row.id === taskId);
    const next = (await tasks("?completed=false")).find(
      (row) => row.id === done?.recurrence?.nextTaskId,
    );
    expect(next?.dueOn).toBe("2026-12-10");
    expect(next?.recurrence?.occurrenceOn).toBe("2026-12-10");
  });

  it("reads sub-tasks separately from the top-level page", async () => {
    const parentId = await createdId(
      await call("POST", "/api/v1/tasks", { matterId: null, title: "Close the quarter" }),
    );
    const childId = await createdId(
      await call("POST", "/api/v1/tasks", {
        matterId: null,
        title: "Reconcile trust",
        parentTaskId: parentId,
      }),
    );
    const topLevel = await tasks("?topLevel=true");
    expect(topLevel.some((row) => row.id === parentId)).toBe(true);
    expect(topLevel.some((row) => row.id === childId)).toBe(false);
    const response = await call("GET", `/api/v1/tasks/subtask-trees?rootIds=${parentId}`);
    expect(response.status).toBe(200);
    const trees = ((await response.json()) as { data: TaskBody[] }).data;
    expect(trees.map((row) => [row.id, row.parentTaskId])).toEqual([[childId, parentId]]);
  });

  it("narrows to the reader's own work in Me Mode", async () => {
    const assignedId = await createdId(
      await call("POST", "/api/v1/tasks", {
        matterId: null,
        title: "Mine to do",
        assignees: [{ userId: ownerUserId }],
      }),
    );
    const watchedId = await createdId(
      await call("POST", "/api/v1/tasks", {
        matterId: null,
        title: "Mine to watch",
        watcherUserIds: [ownerUserId],
      }),
    );
    const assigned = await tasks("?mine=assigned");
    expect(assigned.some((row) => row.id === assignedId)).toBe(true);
    expect(assigned.some((row) => row.id === watchedId)).toBe(false);
    const watching = await tasks("?mine=watching");
    expect(watching.some((row) => row.id === watchedId)).toBe(true);
    expect(watching.some((row) => row.id === assignedId)).toBe(false);
    const both = await tasks("?mine=both");
    expect(both.some((row) => row.id === assignedId)).toBe(true);
    expect(both.some((row) => row.id === watchedId)).toBe(true);
  });
});
