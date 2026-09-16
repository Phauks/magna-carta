import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE TASK PARTICIPANTS MIGRATION, RUN OVER A DATABASE THAT ALREADY HOLDS ROWS.
 *
 * It creates two tables and then MOVES data: every task with a name in the retired one-name column
 * gets a participant row in the `assigned` role, and the column is emptied in the same migration so
 * the two homes for "whose task" never both hold a value. Against an empty table the INSERT and the
 * UPDATE are indistinguishable from correct ones, so this seeds tasks with and without an assignee
 * at the pre-migration schema, applies the rest of the lineage, and asserts what each row became —
 * the shape task-rungs-migration.test.ts set for the migration before it.
 */
const TAG = "20260916T120000_task-participants-and-checklist";
const NOW = "2026-09-16T12:00:00.000Z";
const AUTHOR = "user_seed0000000000000000000";
const ASSIGNEE = "user_seedAssignee00000000000";

// Matterless tasks, so nothing has to stand up a matter to ask a question about the task table.
function seedThroughTheOldSchema(raw: DatabaseSync): void {
  const insertTask = raw.prepare(
    `INSERT INTO matter_task
       (id, matter_id, title, created_by, assignee_user_id, priority, state, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, 'normal', 'open', ?, ?)`,
  );
  insertTask.run("matterTask_assigned00000000", "Draft the responses", AUTHOR, ASSIGNEE, NOW, NOW);
  insertTask.run("matterTask_unassigned000000", "Confirm the venue", AUTHOR, null, NOW, NOW);
}

describe("the task participants migration, over rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("is in the lineage", () => {
    expect(at).toBeGreaterThan(0);
  });

  it("moves each assignee into a participant row and empties the retired column", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    seedThroughTheOldSchema(raw);

    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    const participants = raw
      .prepare(
        "SELECT id, task_id, user_id, role, added_by, added_at FROM matter_task_participant ORDER BY id",
      )
      .all() as Record<string, unknown>[];
    expect(participants).toEqual([
      {
        // The task's own token under the participant prefix: unique because a task held at most
        // one assignee, and the same alphabet and length every minted handle has.
        id: "matterTaskParticipant_assigned00000000",
        task_id: "matterTask_assigned00000000",
        user_id: ASSIGNEE,
        role: "assigned",
        added_by: null,
        added_at: NOW,
      },
    ]);

    // The old column is empty on every row, assigned or not.
    const remaining = raw
      .prepare("SELECT COUNT(*) AS n FROM matter_task WHERE assignee_user_id IS NOT NULL")
      .get() as { n: number };
    expect(remaining.n).toBe(0);

    // The unassigned task got no participant and lost nothing.
    const unassigned = raw
      .prepare("SELECT title, created_by FROM matter_task WHERE id = ?")
      .get("matterTask_unassigned000000") as Record<string, unknown>;
    expect(unassigned).toEqual({ title: "Confirm the venue", created_by: AUTHOR });
  });

  it("enforces the role vocabulary, one role per person, and the checklist's done shape", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations);
    raw
      .prepare(
        `INSERT INTO matter_task (id, matter_id, title, created_by, priority, state, created_at, updated_at)
         VALUES (?, NULL, 'A task', ?, 'normal', 'open', ?, ?)`,
      )
      .run("matterTask_shape00000000000", AUTHOR, NOW, NOW);
    const insertParticipant = raw.prepare(
      `INSERT INTO matter_task_participant (id, task_id, user_id, role, added_by, added_at)
       VALUES (?, 'matterTask_shape00000000000', ?, ?, ?, ?)`,
    );
    insertParticipant.run("matterTaskParticipant_one0000", ASSIGNEE, "watcher", AUTHOR, NOW);

    // A fifth role is a reviewed migration, refused at the database.
    expect(() =>
      insertParticipant.run("matterTaskParticipant_two0000", AUTHOR, "owner", AUTHOR, NOW),
    ).toThrow();
    // A second row for the same person on the same task is refused: a role is replaced, not added.
    expect(() =>
      insertParticipant.run("matterTaskParticipant_three00", ASSIGNEE, "assigned", AUTHOR, NOW),
    ).toThrow();

    const insertLine = raw.prepare(
      `INSERT INTO matter_task_checklist_item
         (id, task_id, title, position, done_at, done_by, created_by, created_at, updated_at)
       VALUES (?, 'matterTask_shape00000000000', ?, 0, ?, ?, ?, ?, ?)`,
    );
    insertLine.run("matterTaskChecklistItem_ok000", "Pull the file", null, null, AUTHOR, NOW, NOW);
    // A blank line is not a step.
    expect(() =>
      insertLine.run("matterTaskChecklistItem_blank", "", null, null, AUTHOR, NOW, NOW),
    ).toThrow();
    // Ticked by nobody is refused: an instant and an actor are one fact.
    expect(() =>
      insertLine.run("matterTaskChecklistItem_half0", "Call back", NOW, null, AUTHOR, NOW, NOW),
    ).toThrow();
  });
});
