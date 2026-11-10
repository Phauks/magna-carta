import { describe, expect, it } from "vitest";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { createMatterTask } from "../src/task-service.ts";
import {
  decodeTaskCursor,
  encodeTaskSortKey,
  selectMatterTasksStatement,
  selectMyTasksStatement,
  type MatterTaskRow,
  type TaskListFilters,
} from "../src/task-statements.ts";
import {
  ACTOR,
  CLOSED_MATTER,
  COLLEAGUE,
  HOLDING_MATTER,
  MATTER,
  OTHER_MATTER,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  visibility,
} from "./support.ts";

type ListRow = MatterTaskRow & { priority_rank: number };

async function seedTasks(
  specs: readonly Partial<Parameters<typeof createMatterTask>[1]>[],
): Promise<ReturnType<typeof migratedDatabase>> {
  const database = migratedDatabase();
  seedFirm(database.raw);
  for (const [index, spec] of specs.entries()) {
    const created = await createMatterTask(
      database.database,
      { matterId: MATTER, title: `Task ${String(index)}`, ...spec },
      options,
    );
    await commit(database.database, created.effect);
  }
  return database;
}

async function listMatter(
  database: ReturnType<typeof migratedDatabase>["database"],
  extra: {
    limit?: number;
    filters?: TaskListFilters;
    cursor?: ReturnType<typeof decodeTaskCursor>;
  } = {},
): Promise<ListRow[]> {
  const { results } = await selectMatterTasksStatement(database, MATTER, {
    limit: extra.limit ?? 50,
    visibility,
    viewerUserId: ACTOR,
    filters: extra.filters,
    cursor: extra.cursor,
  }).all<ListRow>();
  return results;
}

describe("the ordering", () => {
  it("puts what is due next first, and everything undated last", async () => {
    // SQLite orders NULL first on an ascending sort, which would put every task nobody has
    // scheduled at the top of a list whose whole job is to say what is due next.
    const { database } = await seedTasks([
      { title: "Undated" },
      { title: "Later", dueOn: "2026-12-01", timeZone: "America/Los_Angeles" },
      { title: "Sooner", dueOn: "2026-09-15", timeZone: "America/Los_Angeles" },
    ]);
    const rows = await listMatter(database);
    expect(rows.map((row) => row.title)).toEqual(["Sooner", "Later", "Undated"]);
  });

  it("breaks a tie on the same date by urgency", async () => {
    const { database } = await seedTasks([
      { title: "Normal", dueOn: "2026-09-15", timeZone: "America/Los_Angeles" },
      {
        title: "Urgent",
        dueOn: "2026-09-15",
        timeZone: "America/Los_Angeles",
        priority: "urgent",
      },
      { title: "Low", dueOn: "2026-09-15", timeZone: "America/Los_Angeles", priority: "low" },
    ]);
    const rows = await listMatter(database);
    expect(rows.map((row) => row.title)).toEqual(["Urgent", "Normal", "Low"]);
  });
});

describe("the keyset walk", () => {
  it("visits every task exactly once across pages", async () => {
    // Three sort terms means a three-level cursor comparison, and getting it wrong skips or repeats
    // rows at a page boundary rather than failing. The mix here is deliberate: two dates, three
    // priorities, and undated rows, so every level of the comparison is exercised.
    const specs = [
      { title: "A", dueOn: "2026-09-15", timeZone: "America/Los_Angeles", priority: "urgent" },
      { title: "B", dueOn: "2026-09-15", timeZone: "America/Los_Angeles", priority: "normal" },
      { title: "C", dueOn: "2026-09-15", timeZone: "America/Los_Angeles", priority: "normal" },
      { title: "D", dueOn: "2026-09-16", timeZone: "America/Los_Angeles", priority: "low" },
      { title: "E" },
      { title: "F", priority: "high" },
    ];
    const { database } = await seedTasks(specs);
    const expected = (await listMatter(database)).map((row) => row.id);
    expect(expected).toHaveLength(specs.length);

    const walked: string[] = [];
    let cursor: ReturnType<typeof decodeTaskCursor>;
    for (let page = 0; page < 10; page++) {
      const rows = await listMatter(database, { limit: 2, cursor });
      if (rows.length === 0) break;
      walked.push(...rows.map((row) => row.id));
      const last = rows.at(-1);
      if (last === undefined || rows.length < 2) break;
      cursor = decodeTaskCursor(encodeTaskSortKey(last), last.id);
    }
    expect(walked).toEqual(expected);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("treats a malformed sort key as the first page rather than throwing", () => {
    expect(decodeTaskCursor("nonsense", "matterTask_x")).toBeUndefined();
    expect(decodeTaskCursor("2026-09-15|notanumber", "matterTask_x")).toBeUndefined();
    expect(decodeTaskCursor("|2", "matterTask_x")).toEqual({
      dueOn: null,
      priorityRank: 2,
      id: "matterTask_x",
    });
  });
});

describe("the filters", () => {
  it("narrows by state, priority, assignee and due window", async () => {
    const { database } = await seedTasks([
      { title: "Mine", assigneeUserId: ACTOR, dueOn: "2026-09-15", timeZone: "UTC" },
      { title: "Theirs", assigneeUserId: COLLEAGUE, dueOn: "2026-09-20", timeZone: "UTC" },
      { title: "Urgent", priority: "urgent", dueOn: "2026-10-01", timeZone: "UTC" },
    ]);
    expect(
      (await listMatter(database, { filters: { assigneeUserId: ACTOR } })).map((row) => row.title),
    ).toEqual(["Mine"]);
    expect(
      (await listMatter(database, { filters: { priorities: ["urgent"] } })).map((row) => row.title),
    ).toEqual(["Urgent"]);
    expect(
      (await listMatter(database, { filters: { dueFrom: "2026-09-16", dueTo: "2026-09-30" } })).map(
        (row) => row.title,
      ),
    ).toEqual(["Theirs"]);
    expect(
      await listMatter(database, { filters: { rungs: ["to_do", "in_progress", "on_hold"] } }),
    ).toHaveLength(3);
  });

  it("matches a search against the title and the body, and treats wildcards as text", async () => {
    const { database } = await seedTasks([
      { title: "Call Mrs Herrera", body: "The settlement offer is on page three" },
      { title: "File the 50% fee split motion" },
    ]);
    expect(await listMatter(database, { filters: { search: "herrera" } })).toHaveLength(1);
    expect(await listMatter(database, { filters: { search: "settlement" } })).toHaveLength(1);
    // The wildcard is the caller's text, not their instruction: a bare "%" finds the one task whose
    // title literally contains a percent sign, rather than matching every task on the matter.
    expect(await listMatter(database, { filters: { search: "50%" } })).toHaveLength(1);
    const percent = await listMatter(database, { filters: { search: "%" } });
    expect(percent).toHaveLength(1);
    expect(percent[0]?.title).toContain("50%");
    // And an underscore is text too, so it matches nothing here rather than any single character.
    expect(await listMatter(database, { filters: { search: "_" } })).toHaveLength(0);
  });
});

describe("my work", () => {
  it("spans matters and carries the member's own matterless tasks", async () => {
    const database = migratedDatabase();
    seedFirm(database.raw);
    for (const spec of [
      { matterId: MATTER, title: "On a case" },
      { matterId: OTHER_MATTER, title: "On another case" },
      { matterId: null, title: "Renew the malpractice policy" },
    ]) {
      const created = await createMatterTask(
        database.database,
        spec as Parameters<typeof createMatterTask>[1],
        options,
      );
      await commit(database.database, created.effect);
    }
    const { results } = await selectMyTasksStatement(database.database, {
      limit: 50,
      visibility,
      viewerUserId: ACTOR,
    }).all<ListRow>();
    // One statement rather than two unioned: the branch is in the visibility fragment and the list
    // does not know it exists.
    expect(results.map((row) => row.title).toSorted()).toEqual([
      "On a case",
      "On another case",
      "Renew the malpractice policy",
    ]);
  });

  it("leaves out tasks on closed matters, and brings them back when asked", async () => {
    const database = migratedDatabase();
    seedFirm(database.raw);
    for (const spec of [
      { matterId: MATTER, title: "Live" },
      { matterId: CLOSED_MATTER, title: "On a closed matter" },
    ]) {
      const created = await createMatterTask(
        database.database,
        spec as Parameters<typeof createMatterTask>[1],
        options,
      );
      await commit(database.database, created.effect);
    }
    const base = { limit: 50, visibility, viewerUserId: ACTOR as UserId };
    const { results: filtered } = await selectMyTasksStatement(
      database.database,
      base,
    ).all<ListRow>();
    expect(filtered.map((row) => row.title)).toEqual(["Live"]);
    // A FILTER and not a state change: the task on the closed matter is untouched, so reopening
    // the matter brings it back with no backfill.
    const { results: all } = await selectMyTasksStatement(database.database, {
      ...base,
      includeClosedMatters: true,
    }).all<ListRow>();
    expect(all.map((row) => row.title).toSorted()).toEqual(["Live", "On a closed matter"]);
  });

  it("never returns a task on a platform-owned holding matter", async () => {
    const database = migratedDatabase();
    seedFirm(database.raw);
    // The write path refuses to put a task there through the ordinary route, so this is inserted
    // directly: the read is what has to hold, whatever put the row there.
    database.raw.exec(
      `INSERT INTO matter_task (id, matter_id, title, created_by, priority, state, created_at, updated_at)` +
        ` VALUES ('matterTask_holdingRow00000000', '${HOLDING_MATTER}', 'Should never be read', '${ACTOR}', 'normal', 'open', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    );
    const { results } = await selectMyTasksStatement(database.database, {
      limit: 50,
      visibility,
      viewerUserId: ACTOR,
    }).all<ListRow>();
    expect(results).toHaveLength(0);
    const { results: onMatter } = await selectMatterTasksStatement(
      database.database,
      HOLDING_MATTER as MatterId,
      { limit: 50, visibility, viewerUserId: ACTOR },
    ).all<ListRow>();
    expect(onMatter).toHaveLength(0);
  });

  it("shows another member's matterless task on this member's list", async () => {
    const database = migratedDatabase();
    seedFirm(database.raw);
    const mine = await createMatterTask(
      database.database,
      { matterId: null, title: "Renew the malpractice policy" },
      options,
    );
    await commit(database.database, mine.effect);
    const { results } = await selectMyTasksStatement(database.database, {
      limit: 50,
      visibility,
      viewerUserId: COLLEAGUE,
    }).all<ListRow>();
    expect(results).toHaveLength(1);
  });
});
