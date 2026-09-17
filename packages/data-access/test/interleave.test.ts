import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";
import type { BatchDatabase } from "../src/effect-batch.ts";
import {
  afterRead,
  beforeCommit,
  interleaveAt,
  InterleaveNotReachedError,
  runInterleaved,
} from "../src/interleave.ts";

// The harness's own verifier, and it exists for the reason every gate needs one: a harness that has
// quietly stopped firing does not fail, it passes everything handed to it. So these tests assert
// that it can still see a commit and a read, and that it refuses rather than returns when it cannot.

function freshDatabase(): BatchDatabase {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

// A stand-in for the shape every domain mutation has: read a precondition, decide, commit a guarded
// write whose WHERE repeats the precondition. Returns the rows the commit changed, so a caller that
// lost the race is visible as a zero.
async function guardedRename(
  database: BatchDatabase,
  settingKey: string,
  expected: string,
  next: string,
): Promise<number> {
  const { results } = await database
    .prepare("SELECT value FROM setting WHERE key = ?1")
    .bind(settingKey)
    .all<{ value: string }>();
  if (results[0]?.value !== expected) return 0;
  const update = database
    .prepare("UPDATE setting SET value = ?2 WHERE key = ?1 AND value = ?3")
    .bind(settingKey, next, expected);
  await database.batch([update]);
  const { results: after } = await database
    .prepare("SELECT value FROM setting WHERE key = ?1")
    .bind(settingKey)
    .all<{ value: string }>();
  return after[0]?.value === next ? 1 : 0;
}

async function seed(database: BatchDatabase, key: string, value: string): Promise<void> {
  await database
    .prepare("INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)")
    .bind(key, value, "2026-09-16T00:00:00.000Z")
    .run();
}

async function readSetting(database: BatchDatabase, key: string): Promise<string | undefined> {
  const { results } = await database
    .prepare("SELECT value FROM setting WHERE key = ?1")
    .bind(key)
    .all<{ value: string }>();
  return results[0]?.value;
}

describe("the interleave harness fires where it says it does", () => {
  it("runs the competing writer before the commit, so the guarded write sees the changed row", async () => {
    const database = freshDatabase();
    await seed(database, "theme", "light");

    const lost = await runInterleaved({
      database,
      concurrentWriter: () => guardedRename(database, "theme", "light", "dark"),
      operation: (racing) => guardedRename(racing, "theme", "light", "sepia"),
    });

    // The loser read `light`, composed its guarded UPDATE, and by the time it committed the winner
    // had moved the row — so its WHERE matched nothing and the winner's value stands.
    expect(lost).toBe(0);
    expect(await readSetting(database, "theme")).toBe("dark");
  });

  it("runs the competing writer after a named read, before the operation decides", async () => {
    const database = freshDatabase();
    await seed(database, "theme", "light");

    const lost = await runInterleaved({
      database,
      point: afterRead("SELECT value FROM setting"),
      concurrentWriter: () => guardedRename(database, "theme", "light", "dark"),
      operation: (racing) => guardedRename(racing, "theme", "light", "sepia"),
    });

    expect(lost).toBe(0);
    expect(await readSetting(database, "theme")).toBe("dark");
  });

  it("counts commits, so a later commit can be the one raced", async () => {
    const database = freshDatabase();
    await seed(database, "theme", "light");
    await seed(database, "density", "roomy");

    const fired: string[] = [];
    const racing = interleaveAt(database, beforeCommit(2), () => {
      fired.push("second");
      return Promise.resolve();
    });
    await guardedRename(racing, "theme", "light", "sepia");
    expect(fired).toEqual([]); // the first commit passed untouched
    await guardedRename(racing, "density", "roomy", "compact");
    expect(fired).toEqual(["second"]);
    expect(racing.interleaved).toBe(true);
  });

  it("hands the underlying database's own statements to batch, not the wrappers it observed reads through", async () => {
    // node-sqlite's batch documents that statements must come from its own prepare. Reads are
    // observed through a wrapper, so the wrapper has to be unwound before the commit or every
    // after-read test would be committing through an object the adapter never made.
    const database = freshDatabase();
    await seed(database, "theme", "light");
    const racing = interleaveAt(database, afterRead("SELECT value FROM setting"), () =>
      Promise.resolve(),
    );
    await expect(guardedRename(racing, "theme", "light", "sepia")).resolves.toBe(1);
    expect(await readSetting(database, "theme")).toBe("sepia");
  });
});

describe("the interleave harness refuses to pass vacuously", () => {
  it("throws when the operation succeeded without ever reaching the point", async () => {
    const database = freshDatabase();
    await seed(database, "theme", "light");

    await expect(
      runInterleaved({
        database,
        point: beforeCommit(2), // there is only one commit
        concurrentWriter: () => Promise.reject(new Error("must never run")),
        operation: (racing) => guardedRename(racing, "theme", "light", "sepia"),
      }),
    ).rejects.toBeInstanceOf(InterleaveNotReachedError);
  });

  it("throws when the operation refused BEFORE the point, and keeps that refusal as the cause", async () => {
    // The dangerous shape: a test asserts `rejects` and passes, but the refusal came from a
    // precondition the operation never got past rather than from the race the test claims to pin.
    const database = freshDatabase();
    await seed(database, "theme", "light");

    const caught = await runInterleaved({
      database,
      concurrentWriter: () => Promise.resolve(),
      operation: () => Promise.reject(new Error("refused before composing anything")),
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(InterleaveNotReachedError);
    expect((caught as InterleaveNotReachedError).operationFailure).toMatchObject({
      message: "refused before composing anything",
    });
  });

  it("names the point it was waiting for, so the message says what to fix", async () => {
    const database = freshDatabase();
    const caught = await runInterleaved({
      database,
      point: afterRead("SELECT value FROM matter"),
      concurrentWriter: () => Promise.resolve(),
      operation: () => Promise.resolve("done"),
    }).catch((error: unknown) => error);

    expect((caught as Error).message).toContain(
      'the first read matching "SELECT value FROM matter"',
    );
  });

  it("passes the operation's own refusal straight through once the point HAS been reached", async () => {
    const database = freshDatabase();
    await seed(database, "theme", "light");

    await expect(
      runInterleaved({
        database,
        concurrentWriter: () => guardedRename(database, "theme", "light", "dark"),
        operation: async (racing) => {
          await guardedRename(racing, "theme", "light", "sepia");
          throw new Error("the domain refusal the test is actually reading");
        },
      }),
    ).rejects.toThrow("the domain refusal the test is actually reading");
  });
});
