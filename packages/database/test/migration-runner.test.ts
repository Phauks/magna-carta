import { describe, expect, it } from "vitest";
import type { Migration } from "../src/migration.ts";
import { runPendingMigrations, type MigrationTarget } from "../src/migration-runner.ts";

const MIGRATIONS: Migration[] = [
  { tag: "0000_first", statements: ["CREATE TABLE a (id text);"] },
  { tag: "0001_second", statements: ["ALTER TABLE a ADD col text;"] },
  { tag: "0002_third", statements: ["CREATE INDEX i ON a (col);"] },
];

// In-memory target: records applications; optionally fails on a chosen tag.
function fakeTarget(initiallyApplied: string[], failOnTag?: string) {
  const applied = [...initiallyApplied];
  const target: MigrationTarget = {
    appliedMigrationTags: () => Promise.resolve([...applied]),
    applyMigration: (migration) => {
      if (migration.tag === failOnTag) return Promise.reject(new Error(`boom on ${migration.tag}`));
      applied.push(migration.tag);
      return Promise.resolve();
    },
  };
  return { target, applied };
}

describe("runPendingMigrations", () => {
  it("applies everything to a fresh database (provisioning: v0 -> apply all)", async () => {
    const { target, applied } = fakeTarget([]);
    const report = await runPendingMigrations(target, MIGRATIONS);
    expect(applied).toEqual(["0000_first", "0001_second", "0002_third"]);
    expect(report.appliedTags).toEqual(["0000_first", "0001_second", "0002_third"]);
    expect(report.skippedTags).toEqual([]);
  });

  it("skips already-applied migrations and applies only the pending tail (idempotent re-run)", async () => {
    const { target, applied } = fakeTarget(["0000_first"]);
    const report = await runPendingMigrations(target, MIGRATIONS);
    expect(report.skippedTags).toEqual(["0000_first"]);
    expect(applied).toEqual(["0000_first", "0001_second", "0002_third"]);
  });

  it("a fully-current database is a no-op", async () => {
    const { target } = fakeTarget(["0000_first", "0001_second", "0002_third"]);
    const report = await runPendingMigrations(target, MIGRATIONS);
    expect(report.appliedTags).toEqual([]);
  });

  it("stops at the first failure — later migrations are not attempted", async () => {
    const { target, applied } = fakeTarget([], "0001_second");
    await expect(runPendingMigrations(target, MIGRATIONS)).rejects.toThrow(/0001_second/);
    expect(applied).toEqual(["0000_first"]); // 0002 was never attempted
  });

  it("fails loud when the database has an applied tag the code does not know (deploy mismatch)", async () => {
    const { target } = fakeTarget(["9999_from_the_future"]);
    await expect(runPendingMigrations(target, MIGRATIONS)).rejects.toThrow(/9999_from_the_future/);
  });
});
