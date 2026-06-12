import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase, openNodeDatabaseFile } from "../src/node-sqlite.ts";

// Pin test: the snapshot layer of the fixtures load-profile harness persists an in-memory
// database with node:sqlite's backup() and reopens the file WITHOUT re-applying migrations.
// This proves both halves against the real Node API (the node:sqlite pin-test pattern).
describe("node-sqlite file persistence", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("backs an in-memory database up to a file and reopens it with data intact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mc-node-sqlite-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "snapshot.sqlite");

    const source = createMigratedNodeDatabase("per-firm");
    source.raw
      .prepare(
        "INSERT INTO idempotency_key (id, key, fingerprint, status, response_code, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("idem_pin", "key_pin", "fp", "completed", 200, "{}", "2026-01-05T09:00:00.000Z");

    await backup(source.raw, filePath);

    const reopened = openNodeDatabaseFile(filePath);
    const { results } = await reopened.database
      .prepare("SELECT key FROM idempotency_key WHERE key = ?1")
      .bind("key_pin")
      .all<{ key: string }>();
    expect(results).toEqual([{ key: "key_pin" }]);

    // The reopened handle is batch-capable (the D1-shaped contract the harness relies on).
    const batchResult = await reopened.database.batch([reopened.database.prepare("SELECT 1")]);
    expect(batchResult).toHaveLength(1);

    // Close before cleanup — Windows refuses to delete a file another handle still holds open.
    reopened.raw.close();
    source.raw.close();
  });
});
