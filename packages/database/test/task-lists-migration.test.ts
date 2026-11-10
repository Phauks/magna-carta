import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE TASK LISTS MIGRATION, RUN OVER A DATABASE THAT ALREADY HOLDS TASKS.
 *
 * A data migration whose UPDATE is wrong is indistinguishable from a correct one against an empty
 * table. This one puts every existing task on the firm's first list at the status its rung named,
 * and copies each assignee into the new assignee rows. So: seed a task on each rung, one with an
 * assignee and one without, apply the rest of the lineage, and require each lands where its rung
 * said, with nothing inferred and nothing lost.
 */
const TAG = "20261110T005324_task-lists-statuses-and-teams";
const NOW = "2026-11-01T12:00:00.000Z";
const SEED_USER = "user_seed0000000000000000000";

function seed(raw: DatabaseSync): void {
  const insert = raw.prepare(
    `INSERT INTO matter_task (id, matter_id, title, assignee_user_id, created_by, priority, state,
       progress, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, 'normal', 'open', ?, ?, ?)`,
  );
  insert.run("matterTask_toDo000000000000", "Draft", SEED_USER, SEED_USER, "to_do", NOW, NOW);
  insert.run("matterTask_started000000000", "Review", null, SEED_USER, "in_progress", NOW, NOW);
  insert.run("matterTask_held00000000000", "Wait", null, SEED_USER, "on_hold", NOW, NOW);
}

describe("the task lists migration, over rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("is in the lineage (guards the split itself)", () => {
    expect(at).toBeGreaterThan(0);
  });

  it("puts every task on the first list at its rung's status, and carries its assignee", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    seed(raw);
    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    const rows = raw
      .prepare(
        `SELECT matter_task.id, matter_task.list_id, task_list_status.name AS status
         FROM matter_task JOIN task_list_status ON task_list_status.id = matter_task.status_id
         ORDER BY matter_task.id`,
      )
      .all() as { id: string; list_id: string; status: string }[];
    expect(rows).toEqual([
      {
        id: "matterTask_held00000000000",
        list_id: "taskList_firmDefaultList000",
        status: "On Hold",
      },
      {
        id: "matterTask_started000000000",
        list_id: "taskList_firmDefaultList000",
        status: "In Progress",
      },
      {
        id: "matterTask_toDo000000000000",
        list_id: "taskList_firmDefaultList000",
        status: "To Do",
      },
    ]);

    const assignees = raw
      .prepare(`SELECT task_id, user_id, position FROM matter_task_assignee ORDER BY task_id`)
      .all();
    expect(assignees).toEqual([
      { task_id: "matterTask_toDo000000000000", user_id: SEED_USER, position: 0 },
    ]);

    // Every move between the three statuses is allowed, so nothing a firm did yesterday is refused.
    const flow = raw.prepare(`SELECT COUNT(*) AS n FROM task_list_status_transition`).get() as {
      n: number;
    };
    expect(flow.n).toBe(6);
  });
});
