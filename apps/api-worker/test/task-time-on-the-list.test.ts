import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The time a task has taken, as the task list carries it.
//
// It rides the list rather than a route of its own because the list is the only task surface, and a
// per-task read would put a round-trip on every row of every page. What that leaves this test to
// pin is the part the domain package cannot: the number means two different things depending on who
// is asking — `time:viewFirm` sees what the task cost the firm, everybody else sees what THEY put
// into it — so the scope rides with the totals.

let poolFirmId: FirmId;
let ownerCookie: string;
let paralegalCookie: string;
let ownerUserId: UserId;
let paralegalUserId: UserId;

const MATTER_ID = "matter_taskTimeMatter0000000";
const TASK_ID = "matterTask_taskTimeTask000000000";
const FIRM_WORK_TASK_ID = "matterTask_taskTimePrivate000000";
const UNTOUCHED_TASK_ID = "matterTask_taskTimeUntouched0000";

async function seedMemberWithRole(
  userId: UserId,
  displayName: string,
  roleName: string,
): Promise<void> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const role = await database
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  await insertMemberStatement(database, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(database, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role!.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Task Time Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("task-time-owner@example.com", {
    userName: "Task Time Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Task Time Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("task-time-owner@example.com");

  // A Paralegal holds tasks:read and NOT time:viewFirm, which is exactly the reader the scope
  // narrowing exists for.
  const paralegal = await seedCredentialedUser("task-time-paralegal@example.com", {
    userName: "Task Time Paralegal",
    firmId: poolFirmId,
  });
  paralegalUserId = paralegal.userId;
  await seedMemberWithRole(paralegal.userId, "Task Time Paralegal", "Paralegal");
  paralegalCookie = await signInForSessionCookie("task-time-paralegal@example.com");

  const database = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'Task Time Matter', NULL, 'open', NULL, NULL, ?2, NULL, NULL, NULL, NULL, '2026-01-05', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(MATTER_ID, ownerUserId)
    .run();

  for (const [taskId, matterId] of [
    [TASK_ID, MATTER_ID],
    // On the matter and with nothing logged against it, which is what nearly every task looks like.
    [UNTOUCHED_TASK_ID, MATTER_ID],
    // A task on NO matter, created by and assigned to the owner: the firm's own work, which every
    // member sees, the paralegal included.
    [FIRM_WORK_TASK_ID, null],
  ] as const) {
    await database
      .prepare(
        "INSERT INTO matter_task (id, matter_id, title, body, priority, state, assignee_user_id, due_on, due_at_time, time_zone, blocked_by_task_id, trigger_event_id, deadline_id, completed_at, completed_by, cancelled_at, cancelled_by, cancellation_reason, plan_template_id, plan_task_template_id, created_at, updated_at, created_by) VALUES (?1, ?2, 'Draft the letter', NULL, 'normal', 'open', ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', ?3)",
      )
      .bind(taskId, matterId, ownerUserId)
      .run();
  }

  // Ninety minutes from the owner, thirty from the paralegal, and a void entry that counts for
  // nobody.
  const entries: [string, string, number, string][] = [
    ["timeEntry_taskTimeOwner00000000", ownerUserId, 90, "draft"],
    ["timeEntry_taskTimeParalegal0000", paralegalUserId, 30, "draft"],
    ["timeEntry_taskTimeVoid000000000", ownerUserId, 600, "void"],
  ];
  for (const [id, timekeeperUserId, durationMinutes, status] of entries) {
    await database
      .prepare(
        "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, task_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, '2026-06-22', ?4, ?4, 'work', 1, NULL, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, ?5, 'manual', NULL, ?6, NULL, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', ?3)",
      )
      .bind(id, MATTER_ID, timekeeperUserId, durationMinutes, status, TASK_ID)
      .run();
  }
});

function get(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

interface TimeLogged {
  billableMinutes: number;
  nonBillableMinutes: number;
  entryCount: number;
  scope: "firm" | "own";
}

interface TaskRow {
  id: string;
  timeLogged: TimeLogged;
}

async function tasksOnMatter(cookie: string): Promise<TaskRow[]> {
  const response = await get(`/api/v1/matters/${MATTER_ID}/tasks`, cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: TaskRow[] }).data;
}

describe("the time logged against a task", () => {
  it("gives a member who may see the firm's time the whole task's, and says so", async () => {
    const task = (await tasksOnMatter(ownerCookie)).find((row) => row.id === TASK_ID);
    // 90 + 30, with the void entry's 600 left out.
    expect(task?.timeLogged).toEqual({
      billableMinutes: 120,
      nonBillableMinutes: 0,
      entryCount: 2,
      scope: "firm",
    });
  });

  it("gives a member without time:viewFirm only their own, and says that instead", async () => {
    const task = (await tasksOnMatter(paralegalCookie)).find((row) => row.id === TASK_ID);
    expect(task?.timeLogged).toEqual({
      billableMinutes: 30,
      nonBillableMinutes: 0,
      entryCount: 1,
      scope: "own",
    });
  });

  // Most tasks have no time against them, and a consumer needs that to be a value it can print
  // rather than a missing key it has to remember to default.
  it("carries zeroes rather than nothing for a task nobody has logged time to", async () => {
    const tasks = await tasksOnMatter(ownerCookie);
    const untouched = tasks.find((row) => row.id === UNTOUCHED_TASK_ID);
    expect(untouched?.timeLogged).toEqual({
      billableMinutes: 0,
      nonBillableMinutes: 0,
      entryCount: 0,
      scope: "firm",
    });
  });

  // A task on no matter is the firm's own work and every member sees it. Whose time it shows is
  // still the reader's answer: a member without the firm-time permission sees their own.
  it("shows a task on no matter to every member, with only their own time", async () => {
    const mine = await get("/api/v1/tasks", paralegalCookie);
    expect(mine.status).toBe(200);
    const rows = ((await mine.json()) as { data: TaskRow[] }).data;
    const firmTask = rows.find((row) => row.id === FIRM_WORK_TASK_ID);
    expect(firmTask?.timeLogged.scope).toBe("own");
  });

  it("refuses an unauthenticated reader", async () => {
    const response = await SELF.fetch(`https://example.com/api/v1/matters/${MATTER_ID}/tasks`, {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });
});
