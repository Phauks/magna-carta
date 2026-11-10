import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE MIGRATION THAT SENDS REFUSED RECORDINGS BACK TO BE JUDGED, RUN OVER ROWS.
 *
 * An UPDATE with a WHERE is indistinguishable from a correct one against an empty table, and this
 * one must clear exactly one verdict out of four: a refusal goes back to unjudged, while a recording
 * already playable, one the judgement could not settle, and one never judged are all left as they
 * were. Seed one of each at the schema before the migration, apply the rest, and read them back.
 */
const TAG = "20261110T083359_rejudge-download-only-recordings";

const NOW = "2026-11-10T08:00:00.000Z";

// Each version hangs off a real file in a real matter, because the migration runner checks every
// reference once the batch lands, and a version whose file is missing fails that check rather than
// asking this migration anything.
function seed(raw: DatabaseSync): void {
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?, 'Seed Member', 'active', ?)`,
    )
    .run("user_rejudgeSeed0000000000", NOW);
  raw
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, opened_at, created_at, updated_at)
       VALUES (?, 'Smith v Jones', 'open', ?, ?, ?, ?)`,
    )
    .run("matter_rejudgeSeed000000000", "user_rejudgeSeed0000000000", NOW, NOW, NOW);
  const insertFile = raw.prepare(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertVersion = raw.prepare(
    `INSERT INTO file_version (id, file_id, version_number, r2_key, status, inline_playable, created_at)
     VALUES (?, ?, 1, ?, 'clean', ?, ?)`,
  );
  const insert = {
    run(versionId: string, fileId: string, r2Key: string, verdict: string | null): void {
      insertFile.run(fileId, "matter_rejudgeSeed000000000", `${fileId}.mp4`, NOW, NOW);
      insertVersion.run(versionId, fileId, r2Key, verdict, NOW);
    },
  };
  insert.run("fileVersion_refused000000", "file_refused00000000000", "r2/refused", "download-only");
  insert.run("fileVersion_playable00000", "file_playable0000000000", "r2/playable", "playable");
  insert.run(
    "fileVersion_unsettled0000",
    "file_unsettled000000000",
    "r2/unsettled",
    "indeterminate",
  );
  insert.run("fileVersion_unjudged00000", "file_unjudged0000000000", "r2/unjudged", null);
}

function verdictOf(raw: DatabaseSync, id: string): unknown {
  const row = raw.prepare("SELECT inline_playable FROM file_version WHERE id = ?").get(id) as
    | { inline_playable: unknown }
    | undefined;
  return row?.inline_playable;
}

describe("the rejudge-download-only-recordings migration, over rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("is in the lineage", () => {
    expect(at).toBeGreaterThan(0);
  });

  it("clears a refusal and leaves every other verdict alone", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    seed(raw);

    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    expect(verdictOf(raw, "fileVersion_refused000000")).toBeNull();
    expect(verdictOf(raw, "fileVersion_playable00000")).toBe("playable");
    expect(verdictOf(raw, "fileVersion_unsettled0000")).toBe("indeterminate");
    expect(verdictOf(raw, "fileVersion_unjudged00000")).toBeNull();
  });
});
