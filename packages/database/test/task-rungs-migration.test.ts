import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE TASK RUNGS AND ARCHIVE MIGRATION, RUN OVER A DATABASE THAT ALREADY HOLDS ROWS.
 *
 * It is not a rebuild — nothing is dropped, so it is outside what
 * rebuilds-over-populated-data.test.ts covers — but it carries the other half of the same risk, and
 * the one that took a firm's database offline before: a DATA migration whose UPDATE is wrong is
 * indistinguishable from a correct one against an empty table. This migration moves every cancelled
 * task onto the archive columns and empties the cancellation ones, and it does both halves in one
 * statement because the CHECK that pairs them would reject either alone. An empty database proves
 * none of that.
 *
 * So: seed a task at each state the old schema allowed, seed a child pointing at one of them, apply
 * the rest of the lineage, and require that it completes, that the cancelled row arrives on the
 * archive columns with its reason intact, that the others are untouched, and that the child still
 * resolves to the row it resolved to before.
 */
const TAG = "20260914T120000_task-rungs-and-archive";
const NOW = "2026-09-06T12:00:00.000Z";

// The tasks are MATTERLESS, which is a shape the schema has and not a convenience: a task's matter
// is nullable, so nothing here has to stand up a matter, a matter type and a responsible member to
// ask a question about the task table. The migration does not read matter_id.
function seedThroughTheOldSchema(raw: DatabaseSync): void {
  const insertTask = raw.prepare(
    `INSERT INTO matter_task
       (id, matter_id, title, created_by, priority, state, completed_at, completed_by,
        cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertTask.run(
    "matterTask_open000000000000",
    null,
    "Draft the interrogatory responses",
    "user_seed0000000000000000000",
    "open",
    null,
    null,
    null,
    null,
    null,
    NOW,
    NOW,
  );
  insertTask.run(
    "matterTask_done000000000000",
    null,
    "Confirm the deposition venue",
    "user_seed0000000000000000000",
    "done",
    NOW,
    "user_seed0000000000000000000",
    null,
    null,
    null,
    NOW,
    NOW,
  );
  insertTask.run(
    "matterTask_cancelled0000000",
    null,
    "Serve the second request",
    "user_seed0000000000000000000",
    "cancelled",
    null,
    null,
    NOW,
    "user_seed0000000000000000000",
    "The client settled the claim this covered.",
    NOW,
    NOW,
  );

  // One child pointing at the row the migration actually touches: an external link, which is the
  // cheapest of matter_task's three children to seed and asks the same question as any of them.
  raw
    .prepare(
      `INSERT INTO matter_task_external_link (id, task_id, system, external_id, created_at, updated_at)
       VALUES (?, ?, 'clickup', 'CU-4417', ?, ?)`,
    )
    .run("matterTaskExternalLink_see00", "matterTask_cancelled0000000", NOW, NOW);
}

function taskRow(raw: DatabaseSync, id: string) {
  return raw.prepare("SELECT * FROM matter_task WHERE id = ?").get(id) as Record<string, unknown>;
}

describe("the task rungs and archive migration, over rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("is in the lineage (guards the split itself)", () => {
    expect(at).toBeGreaterThan(0);
  });

  it("carries a cancelled task onto the archive columns and leaves the others alone", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    seedThroughTheOldSchema(raw);

    const childrenBefore = raw
      .prepare(
        `SELECT COUNT(*) AS n FROM matter_task_external_link
         JOIN matter_task ON matter_task.id = matter_task_external_link.task_id`,
      )
      .get() as { n: number };
    expect(childrenBefore.n).toBe(1);

    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    // The cancelled task: archived, with every word of its reason, and nothing left behind.
    const archived = taskRow(raw, "matterTask_cancelled0000000");
    expect(archived["state"]).toBe("open");
    expect(archived["progress"]).toBe("to_do");
    expect(archived["archived_at"]).toBe(NOW);
    expect(archived["archived_by"]).toBe("user_seed0000000000000000000");
    expect(archived["archive_reason"]).toBe("The client settled the claim this covered.");
    expect(archived["cancelled_at"]).toBeNull();
    expect(archived["cancelled_by"]).toBeNull();
    expect(archived["cancellation_reason"]).toBeNull();

    // An open task lands on the first rung, unarchived. There was never a column saying whether an
    // open task had been started, so To Do is what it was rather than a guess.
    const open = taskRow(raw, "matterTask_open000000000000");
    expect(open["state"]).toBe("open");
    expect(open["progress"]).toBe("to_do");
    expect(open["archived_at"]).toBeNull();

    // A done task stays done and keeps its completion evidence.
    const done = taskRow(raw, "matterTask_done000000000000");
    expect(done["state"]).toBe("done");
    expect(done["completed_by"]).toBe("user_seed0000000000000000000");
    expect(done["archived_at"]).toBeNull();

    // Nothing was re-keyed, so the child resolves to the row it resolved to before.
    const childrenAfter = raw
      .prepare(
        `SELECT COUNT(*) AS n FROM matter_task_external_link
         JOIN matter_task ON matter_task.id = matter_task_external_link.task_id
         WHERE matter_task_external_link.task_id = 'matterTask_cancelled0000000'`,
      )
      .get() as { n: number };
    expect(childrenAfter.n).toBe(1);
  });

  it("enforces the rung and archive shapes afterwards", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations);
    raw
      .prepare(
        `INSERT INTO matter_task (id, matter_id, title, created_by, priority, state, created_at, updated_at)
         VALUES (?, NULL, 'A task', ?, 'normal', 'open', ?, ?)`,
      )
      .run("matterTask_shape00000000000", "user_seed0000000000000000000", NOW, NOW);

    // A rung outside the vocabulary is refused at the database, not only at the type checker.
    expect(() =>
      raw
        .prepare("UPDATE matter_task SET progress = 'nonsense' WHERE id = ?")
        .run("matterTask_shape00000000000"),
    ).toThrow();

    // Half an archiving is refused: an instant and an actor are one fact.
    expect(() =>
      raw
        .prepare("UPDATE matter_task SET archived_at = ? WHERE id = ?")
        .run(NOW, "matterTask_shape00000000000"),
    ).toThrow();

    // A reason with no archiving says why something happened that did not.
    expect(() =>
      raw
        .prepare("UPDATE matter_task SET archive_reason = 'Because' WHERE id = ?")
        .run("matterTask_shape00000000000"),
    ).toThrow();
  });
});
