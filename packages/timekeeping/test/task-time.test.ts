import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { NO_TIME_LOGGED, readTaskTimeSummaries, readTaskTimeSummary } from "../src/task-time.ts";
import { captureTimeEntry, updateDraftTimeEntry } from "../src/time-entry-service.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const TIMEKEEPER = "user_attorney" as UserId;
const COLLEAGUE = "user_paralegal" as UserId;
const MATTER = "matter_a";
const OTHER_MATTER = "matter_b";

const CLOCK = { now: () => "2026-06-22T00:00:00.000Z" };
const OPTIONS = { clock: CLOCK, actorUserId: TIMEKEEPER };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMember(database: BatchDatabase, userId: UserId, name: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', '2026-01-01T00:00:00.000Z')",
    )
    .bind(userId, name)
    .run();
}

async function seedMatter(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'M', NULL, 'open', NULL, NULL, ?2, NULL, NULL, NULL, NULL, '2026-01-05', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(id, TIMEKEEPER)
    .run();
}

// A task on `matterId`, or on NO matter when it is null — the firm's own work.
async function seedTask(
  database: BatchDatabase,
  id: string,
  matterId: string | null,
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter_task (id, matter_id, title, body, priority, state, assignee_user_id, due_on, due_at_time, time_zone, blocked_by_task_id, trigger_event_id, deadline_id, completed_at, completed_by, cancelled_at, cancelled_by, cancellation_reason, plan_template_id, plan_task_template_id, created_at, updated_at, created_by) VALUES (?1, ?2, 'Draft the letter', NULL, 'normal', 'open', ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', ?3)",
    )
    .bind(id, matterId, TIMEKEEPER)
    .run();
}

interface SeedEntry {
  readonly id: string;
  readonly taskId: string | null;
  readonly durationMinutes: number;
  readonly billable: 0 | 1;
  readonly status?: string;
  readonly timekeeperUserId?: UserId;
  readonly matterId?: string;
}

async function seedEntry(database: BatchDatabase, entry: SeedEntry): Promise<void> {
  await database
    .prepare(
      "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, task_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, '2026-06-22', ?4, ?4, 'work', ?5, NULL, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, ?6, 'manual', NULL, ?7, NULL, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', ?3)",
    )
    .bind(
      entry.id,
      entry.matterId ?? MATTER,
      entry.timekeeperUserId ?? TIMEKEEPER,
      entry.durationMinutes,
      entry.billable,
      entry.status ?? "draft",
      entry.taskId,
    )
    .run();
}

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database, TIMEKEEPER, "Attorney");
  await seedMember(database, COLLEAGUE, "Paralegal");
  await seedMatter(database, MATTER);
  await seedMatter(database, OTHER_MATTER);
  await seedTask(database, "matterTask_1", MATTER);
  await seedTask(database, "matterTask_elsewhere", OTHER_MATTER);
  await seedTask(database, "matterTask_firmwork", null);
  return database;
}

const CAPTURE = {
  matterId: MATTER,
  timekeeperUserId: TIMEKEEPER,
  workDate: "2026-06-22",
  rawDurationMinutes: 30,
  durationMinutes: 30,
  narrative: "Worked on it",
  billable: true,
  source: "manual" as const,
  currency: "USD",
  rate: { noRate: true } as const,
};

describe("a time entry names at most one task, and it must be on the entry's own matter", () => {
  it("captures with the link when the task is on the same matter", async () => {
    const database = await setup();
    const captured = await captureTimeEntry(
      database,
      { ...CAPTURE, taskId: "matterTask_1" },
      OPTIONS,
    );
    await commitEffectBatch(database, captured.effect, { now: () => OPTIONS.clock.now() });
    const { results } = await database
      .prepare("SELECT task_id FROM time_entry WHERE id = ?1")
      .bind(captured.timeEntryId)
      .all<{ task_id: string | null }>();
    expect(results[0]?.task_id).toBe("matterTask_1");
  });

  it("refuses a task on another matter", async () => {
    const database = await setup();
    await expect(
      captureTimeEntry(database, { ...CAPTURE, taskId: "matterTask_elsewhere" }, OPTIONS),
    ).rejects.toThrow(expect.objectContaining({ code: "task-not-on-matter" }) as unknown as Error);
  });

  // The firm's own work — renewing the policy, interviewing a candidate — has no matter to bill it
  // to. A null matter_id on the task is a REFUSAL and never a wildcard that matches every matter.
  it("refuses a task on no matter at all", async () => {
    const database = await setup();
    await expect(
      captureTimeEntry(database, { ...CAPTURE, taskId: "matterTask_firmwork" }, OPTIONS),
    ).rejects.toThrow(expect.objectContaining({ code: "task-not-on-matter" }) as unknown as Error);
  });

  it("refuses a task that does not exist", async () => {
    const database = await setup();
    await expect(
      captureTimeEntry(database, { ...CAPTURE, taskId: "matterTask_nothing" }, OPTIONS),
    ).rejects.toThrow(expect.objectContaining({ code: "task-not-on-matter" }) as unknown as Error);
  });

  it("captures with no link at all, which is what nearly every entry does", async () => {
    const database = await setup();
    const captured = await captureTimeEntry(database, CAPTURE, OPTIONS);
    await commitEffectBatch(database, captured.effect, { now: () => OPTIONS.clock.now() });
    const { results } = await database
      .prepare("SELECT task_id FROM time_entry WHERE id = ?1")
      .bind(captured.timeEntryId)
      .all<{ task_id: string | null }>();
    expect(results[0]?.task_id).toBeNull();
  });
});

describe("editing the link on a draft", () => {
  it("links a task the entry's matter owns, and unlinks on null", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      taskId: null,
      durationMinutes: 30,
      billable: 1,
    });
    const linked = await updateDraftTimeEntry(
      database,
      "timeEntry_1" as TimeEntryId,
      { taskId: "matterTask_1" },
      OPTIONS,
    );
    await commitEffectBatch(database, linked.effect, { now: () => OPTIONS.clock.now() });
    const afterLink = await database
      .prepare("SELECT task_id FROM time_entry WHERE id = 'timeEntry_1'")
      .all<{ task_id: string | null }>();
    expect(afterLink.results[0]?.task_id).toBe("matterTask_1");

    const unlinked = await updateDraftTimeEntry(
      database,
      "timeEntry_1" as TimeEntryId,
      { taskId: null },
      OPTIONS,
    );
    await commitEffectBatch(database, unlinked.effect, { now: () => OPTIONS.clock.now() });
    const afterUnlink = await database
      .prepare("SELECT task_id FROM time_entry WHERE id = 'timeEntry_1'")
      .all<{ task_id: string | null }>();
    expect(afterUnlink.results[0]?.task_id).toBeNull();
  });

  it("refuses a cross-matter task on the edit path too", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      taskId: null,
      durationMinutes: 30,
      billable: 1,
    });
    await expect(
      updateDraftTimeEntry(
        database,
        "timeEntry_1" as TimeEntryId,
        { taskId: "matterTask_elsewhere" },
        OPTIONS,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "task-not-on-matter" }) as unknown as Error);
  });

  // The link is an ordinary business column, so the billing freeze governs it like any other. This
  // asserts the freeze reaches the new column rather than trusting that it does.
  it("refuses the link on a billed entry, because a billed row's business columns are frozen", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_billed",
      taskId: null,
      durationMinutes: 30,
      billable: 1,
      status: "billed",
    });
    await expect(
      updateDraftTimeEntry(
        database,
        "timeEntry_billed" as TimeEntryId,
        { taskId: "matterTask_1" },
        OPTIONS,
      ),
    ).rejects.toThrow(TimeEntryValidationError);
    const { results } = await database
      .prepare("SELECT task_id FROM time_entry WHERE id = 'timeEntry_billed'")
      .all<{ task_id: string | null }>();
    expect(results[0]?.task_id).toBeNull();
  });
});

describe("how long a task took", () => {
  it("splits billable from non-billable and counts the entries", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      taskId: "matterTask_1",
      durationMinutes: 90,
      billable: 1,
    });
    await seedEntry(database, {
      id: "timeEntry_2",
      taskId: "matterTask_1",
      durationMinutes: 30,
      billable: 1,
    });
    await seedEntry(database, {
      id: "timeEntry_3",
      taskId: "matterTask_1",
      durationMinutes: 15,
      billable: 0,
    });
    const summary = await readTaskTimeSummary(database, "matterTask_1", null);
    expect(summary).toEqual({ billableMinutes: 120, nonBillableMinutes: 15, entryCount: 3 });
  });

  // A billed hour is still an hour the work took; a discarded capture is not an hour at all.
  it("counts a billed entry and leaves a void one out", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_billed",
      taskId: "matterTask_1",
      durationMinutes: 60,
      billable: 1,
      status: "billed",
    });
    await seedEntry(database, {
      id: "timeEntry_void",
      taskId: "matterTask_1",
      durationMinutes: 600,
      billable: 1,
      status: "void",
    });
    const summary = await readTaskTimeSummary(database, "matterTask_1", null);
    expect(summary).toEqual({ billableMinutes: 60, nonBillableMinutes: 0, entryCount: 1 });
  });

  it("narrows to one timekeeper's own entries when the reader may not see the firm's", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_mine",
      taskId: "matterTask_1",
      durationMinutes: 30,
      billable: 1,
    });
    await seedEntry(database, {
      id: "timeEntry_theirs",
      taskId: "matterTask_1",
      durationMinutes: 90,
      billable: 1,
      timekeeperUserId: COLLEAGUE,
    });
    expect(await readTaskTimeSummary(database, "matterTask_1", null)).toEqual({
      billableMinutes: 120,
      nonBillableMinutes: 0,
      entryCount: 2,
    });
    expect(await readTaskTimeSummary(database, "matterTask_1", TIMEKEEPER)).toEqual({
      billableMinutes: 30,
      nonBillableMinutes: 0,
      entryCount: 1,
    });
  });

  // A caller rendering a list needs "nothing logged" to be a value it can print rather than a
  // missing key it has to remember to default.
  it("answers for every task asked about, including the ones with nothing against them", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      taskId: "matterTask_1",
      durationMinutes: 45,
      billable: 1,
    });
    const summaries = await readTaskTimeSummaries(database, {
      taskIds: ["matterTask_1", "matterTask_elsewhere"],
      onlyTimekeeperUserId: null,
    });
    expect(summaries.get("matterTask_1")?.billableMinutes).toBe(45);
    expect(summaries.get("matterTask_elsewhere")).toEqual(NO_TIME_LOGGED);
  });

  it("asks nothing of the database for an empty set of tasks", async () => {
    const database = await setup();
    const summaries = await readTaskTimeSummaries(database, {
      taskIds: [],
      onlyTimekeeperUserId: null,
    });
    expect(summaries.size).toBe(0);
  });

  // One read per CHUNK, never one per task: the page a list renders can exceed the bound-parameter
  // cap, and the totals must be the same either way.
  it("reads a set larger than one chunk without losing or double-counting a task", async () => {
    const database = await setup();
    const taskIds: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const taskId = `matterTask_bulk_${String(index)}`;
      await seedTask(database, taskId, MATTER);
      await seedEntry(database, {
        id: `timeEntry_bulk_${String(index)}`,
        taskId,
        durationMinutes: 10,
        billable: 1,
      });
      taskIds.push(taskId);
    }
    const summaries = await readTaskTimeSummaries(database, {
      taskIds,
      onlyTimekeeperUserId: null,
    });
    expect(summaries.size).toBe(120);
    for (const taskId of taskIds) {
      expect(summaries.get(taskId)?.billableMinutes, taskId).toBe(10);
    }
  });

  it("narrows a set larger than one chunk to one timekeeper, where a bind is spent on them", async () => {
    const database = await setup();
    const taskIds: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const taskId = `matterTask_bulk_${String(index)}`;
      await seedTask(database, taskId, MATTER);
      await seedEntry(database, {
        id: `timeEntry_mine_${String(index)}`,
        taskId,
        durationMinutes: 10,
        billable: 1,
      });
      await seedEntry(database, {
        id: `timeEntry_theirs_${String(index)}`,
        taskId,
        durationMinutes: 50,
        billable: 1,
        timekeeperUserId: COLLEAGUE,
      });
      taskIds.push(taskId);
    }
    const summaries = await readTaskTimeSummaries(database, {
      taskIds,
      onlyTimekeeperUserId: TIMEKEEPER,
    });
    expect(summaries.size).toBe(120);
    for (const taskId of taskIds) {
      expect(summaries.get(taskId), taskId).toEqual({
        billableMinutes: 10,
        nonBillableMinutes: 0,
        entryCount: 1,
      });
    }
  });
});
