/*
 * Repeating tasks: one current copy, the next written when it is due to appear. Each case pins one
 * rule — when the next copy appears in each of the two modes, what it carries, how a count runs
 * down, how a moved due date moves the series or does not, and that a copy is never made twice.
 */
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterTaskId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  addChecklistItem,
  addTaskLink,
  setTaskWatchers,
  updateChecklistItem,
} from "../src/organisation-service.ts";
import {
  readTaskChecklistItems,
  readTaskLinks,
  readTaskWatchers,
} from "../src/organisation-statements.ts";
import {
  nextCopyOf,
  readScheduledRepeatingTasks,
  scheduledCopyEffects,
  setMatterTaskRecurrence,
} from "../src/recurrence-service.ts";
import { createMatterTask, editMatterTask, setMatterTaskCompleted } from "../src/task-service.ts";
import { readMatterTask } from "../src/task-statements.ts";
import {
  COLLEAGUE,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  visibility,
  ACTOR,
} from "./support.ts";

const ZONE = "America/Los_Angeles";

function setup(): BatchDatabase {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database.database;
}

async function repeatingTask(
  database: BatchDatabase,
  rule: string,
  mode: "completed" | "scheduled" = "completed",
  input: Partial<Parameters<typeof createMatterTask>[1]> = {},
): Promise<MatterTaskId> {
  const created = await createMatterTask(
    database,
    {
      matterId: MATTER,
      title: "Reconcile the trust account",
      dueOn: "2026-11-10",
      timeZone: ZONE,
      startsOn: "2026-11-03",
      ...input,
    },
    options,
  );
  await commit(database, created.effect);
  await commit(
    database,
    (await setMatterTaskRecurrence(database, created.taskId, { rule, mode }, options)).effect,
  );
  return created.taskId;
}

async function read(database: BatchDatabase, taskId: MatterTaskId) {
  const row = await readMatterTask(database, taskId, visibility, ACTOR);
  if (row === undefined) throw new Error(`no task ${taskId}`);
  return row;
}

async function complete(database: BatchDatabase, taskId: MatterTaskId): Promise<void> {
  await commit(database, (await setMatterTaskCompleted(database, taskId, true, options)).effect);
}

describe("the next copy of a repeating task", () => {
  it("falls on the rule's next day, the start the same distance before it", () => {
    expect(
      nextCopyOf({
        recurrence_rule: "FREQ=MONTHLY",
        recurrence_occurrence_on: "2026-11-10",
        due_on: "2026-11-10",
        starts_on: "2026-11-03",
      }),
    ).toEqual({
      dueOn: "2026-12-10",
      startsOn: "2026-12-03",
      occurrenceOn: "2026-12-10",
      rule: "FREQ=MONTHLY",
    });
  });

  it("counts down, and the last copy has no next", () => {
    const second = nextCopyOf({
      recurrence_rule: "FREQ=WEEKLY;COUNT=2",
      recurrence_occurrence_on: "2026-11-10",
      due_on: "2026-11-10",
      starts_on: null,
    });
    expect(second).toMatchObject({ dueOn: "2026-11-17", rule: "FREQ=WEEKLY;COUNT=1" });
    expect(
      nextCopyOf({
        recurrence_rule: second?.rule ?? null,
        recurrence_occurrence_on: "2026-11-17",
        due_on: "2026-11-17",
        starts_on: null,
      }),
    ).toBeNull();
  });

  it("stops at the rule's end date", () => {
    expect(
      nextCopyOf({
        recurrence_rule: "FREQ=MONTHLY;UNTIL=20261201",
        recurrence_occurrence_on: "2026-11-10",
        due_on: "2026-11-10",
        starts_on: null,
      }),
    ).toBeNull();
  });
});

describe("setting a repeat", () => {
  it("needs a due date, and refuses a rule the window could not show", async () => {
    const database = setup();
    const created = await createMatterTask(
      database,
      { matterId: MATTER, title: "Undated" },
      options,
    );
    await commit(database, created.effect);
    await expect(
      setMatterTaskRecurrence(database, created.taskId, { rule: "FREQ=WEEKLY" }, options),
    ).rejects.toMatchObject({ code: "task-recurrence-needs-due-date" });
    const dated = await repeatingTask(database, "FREQ=WEEKLY");
    await expect(
      setMatterTaskRecurrence(database, dated, { rule: "FREQ=WEEKLY;BYMONTHDAY=3" }, options),
    ).rejects.toMatchObject({ code: "task-recurrence-invalid" });
  });

  it("refuses a sub-task, which repeats with its parent", async () => {
    const database = setup();
    const parent = await repeatingTask(database, "FREQ=WEEKLY");
    const child = await createMatterTask(
      database,
      {
        matterId: MATTER,
        title: "Part",
        parentTaskId: parent,
        dueOn: "2026-11-10",
        timeZone: ZONE,
      },
      options,
    );
    await commit(database, child.effect);
    await expect(
      setMatterTaskRecurrence(database, child.taskId, { rule: "FREQ=WEEKLY" }, options),
    ).rejects.toMatchObject({ code: "task-recurrence-subtask" });
  });

  it("starts on completion by default, and stops when the rule is taken off", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY");
    expect((await read(database, taskId)).recurrence_mode).toBe("completed");
    await commit(
      database,
      (await setMatterTaskRecurrence(database, taskId, { rule: null }, options)).effect,
    );
    const row = await read(database, taskId);
    expect([row.recurrence_rule, row.recurrence_mode, row.recurrence_occurrence_on]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("a copy made when this one is completed", () => {
  it("carries the work, the people, the checklist unticked and the links", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=MONTHLY", "completed", {
      location: "Back office",
      priority: "high",
    });
    await commit(database, (await setTaskWatchers(database, taskId, [COLLEAGUE], options)).effect);
    const line = await addChecklistItem(database, taskId, { text: "Pull the statement" }, options);
    await commit(database, line.effect);
    await commit(
      database,
      (await updateChecklistItem(database, line.itemId, { done: true }, options)).effect,
    );
    const link = await addTaskLink(database, taskId, { url: "https://bank.example.com" }, options);
    await commit(database, link.effect);

    await complete(database, taskId);
    const nextId = (await read(database, taskId)).recurrence_next_task_id;
    expect(nextId).not.toBeNull();
    const next = await read(database, nextId as MatterTaskId);
    expect(next).toMatchObject({
      title: "Reconcile the trust account",
      state: "open",
      priority: "high",
      location: "Back office",
      due_on: "2026-12-10",
      starts_on: "2026-12-03",
      time_zone: ZONE,
      recurrence_rule: "FREQ=MONTHLY",
      recurrence_mode: "completed",
      recurrence_occurrence_on: "2026-12-10",
      recurrence_next_task_id: null,
    });
    expect((await readTaskWatchers(database, [next.id])).map((row) => row.user_id)).toEqual([
      COLLEAGUE,
    ]);
    const items = await readTaskChecklistItems(database, [next.id]);
    expect(items.map((item) => [item.text, item.done_at])).toEqual([["Pull the statement", null]]);
    expect((await readTaskLinks(database, [next.id])).map((row) => row.url)).toEqual([
      "https://bank.example.com",
    ]);
  });

  it("is made once: reopening and completing again makes no second copy", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY");
    await complete(database, taskId);
    const first = (await read(database, taskId)).recurrence_next_task_id;
    await commit(database, (await setMatterTaskCompleted(database, taskId, false, options)).effect);
    await complete(database, taskId);
    expect((await read(database, taskId)).recurrence_next_task_id).toBe(first);
  });

  it("is refused whole when another write made the copy first", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY");
    // Both effects are built from the same read, as a completion and the hourly pass would be.
    const one = await setMatterTaskCompleted(database, taskId, true, options);
    const [other] = await scheduledCopyEffects(database, [await read(database, taskId)], {
      clock: { now: () => "2026-11-30T12:00:00.000Z" },
    });
    await commit(database, one.effect);
    await expect(
      commit(database, other ?? { statements: [], outboxMessages: [] }),
    ).rejects.toThrow();
  });
});

describe("a copy that appears on its start date", () => {
  it("appears once its start date has come in the task's own zone", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY", "scheduled");
    // The next copy starts 2026-11-10 (a week after 11-03). 07:00 UTC on the 10th is still the
    // 9th in Los Angeles, so nothing yet.
    const early = await scheduledCopyEffects(
      database,
      await readScheduledRepeatingTasks(database),
      {
        clock: { now: () => "2026-11-10T07:00:00.000Z" },
      },
    );
    expect(early).toHaveLength(0);
    const due = await scheduledCopyEffects(database, await readScheduledRepeatingTasks(database), {
      clock: { now: () => "2026-11-10T09:00:00.000Z" },
    });
    expect(due).toHaveLength(1);
    for (const effect of due) await commit(database, effect);
    const row = await read(database, taskId);
    expect(row.state).toBe("open");
    const next = await read(database, row.recurrence_next_task_id as MatterTaskId);
    expect([next.due_on, next.starts_on]).toEqual(["2026-11-17", "2026-11-10"]);
    // Read again, the task that already has its next copy is not offered.
    expect((await readScheduledRepeatingTasks(database)).map((task) => task.id)).toEqual([next.id]);
  });

  it("takes the rule off the last copy, so the pass stops reading it", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY;COUNT=1", "scheduled");
    for (const effect of await scheduledCopyEffects(
      database,
      await readScheduledRepeatingTasks(database),
      { clock: { now: () => "2026-11-10T09:00:00.000Z" } },
    )) {
      await commit(database, effect);
    }
    expect((await read(database, taskId)).recurrence_rule).toBeNull();
    expect(await readScheduledRepeatingTasks(database)).toHaveLength(0);
  });
});

describe("moving the due date of a repeating task", () => {
  async function moveTo(
    database: BatchDatabase,
    taskId: MatterTaskId,
    dueOn: string,
    scope: "this" | "later",
  ): Promise<void> {
    const row = await read(database, taskId);
    await commit(
      database,
      (
        await editMatterTask(
          database,
          taskId,
          { title: row.title, dueOn, timeZone: ZONE, startsOn: null, recurrenceScope: scope },
          options,
        )
      ).effect,
    );
  }

  it("this one only: the next copy still falls where the rule says", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY");
    await moveTo(database, taskId, "2026-11-12", "this");
    await complete(database, taskId);
    const next = await read(
      database,
      (await read(database, taskId)).recurrence_next_task_id as MatterTaskId,
    );
    expect(next.due_on).toBe("2026-11-17");
  });

  it("this and later ones: the series follows the new date", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY");
    await moveTo(database, taskId, "2026-11-12", "later");
    await complete(database, taskId);
    const next = await read(
      database,
      (await read(database, taskId)).recurrence_next_task_id as MatterTaskId,
    );
    expect(next.due_on).toBe("2026-11-19");
  });

  it("refuses taking the due date off while it repeats", async () => {
    const database = setup();
    const taskId = await repeatingTask(database, "FREQ=WEEKLY");
    await expect(
      editMatterTask(database, taskId, { title: "Reconcile", dueOn: null }, options),
    ).rejects.toMatchObject({ code: "task-recurrence-needs-due-date" });
  });
});
