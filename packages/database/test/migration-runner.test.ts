import { describe, expect, it } from "vitest";
import type { Migration } from "../src/migration.ts";
import {
  outOfOrderArrivals,
  runPendingMigrations,
  type MigrationTarget,
} from "../src/migration-runner.ts";

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
    supersedeAppliedMigrations: (supersededTags, replacementTag) => {
      for (const tag of supersededTags) {
        const at = applied.indexOf(tag);
        if (at !== -1) applied.splice(at, 1);
      }
      applied.push(replacementTag);
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

describe("out-of-order arrivals", () => {
  // Two branches merging can seat a migration behind one that already shipped: the later-tagged one
  // lands first, and the earlier-tagged one reaches a database that has already moved past where it
  // sorts. The runner still applies it — it is pending and needed — so what differs is only the
  // ORDER this database met the pair in, against the order a fresh one will.
  const EARLY = { tag: "20260911T000000_early", statements: ["CREATE TABLE early (id text);"] };
  const LATE = { tag: "20260911T120000_late", statements: ["CREATE TABLE late (id text);"] };
  const CHAIN = [EARLY, LATE];

  it("names a migration arriving behind the ledger's head", () => {
    expect(outOfOrderArrivals(new Set([LATE.tag]), CHAIN)).toEqual([EARLY.tag]);
  });

  it("says nothing when the chain only grows forwards", () => {
    expect(outOfOrderArrivals(new Set([EARLY.tag]), CHAIN)).toEqual([]);
  });

  it("says nothing about a database that has applied the whole chain", () => {
    expect(outOfOrderArrivals(new Set([EARLY.tag, LATE.tag]), CHAIN)).toEqual([]);
  });

  it("says nothing about an empty database, which has no order to disagree with", () => {
    expect(outOfOrderArrivals(new Set(), CHAIN)).toEqual([]);
  });

  it("measures against the ledger's head by TAG, not by how many tags it holds", () => {
    // A ledger holding the late tag alone is still past the early one. Counting would miss this.
    expect(outOfOrderArrivals(new Set([LATE.tag]), CHAIN)).toEqual([EARLY.tag]);
  });

  it("reports it on the run, and still applies the migration", async () => {
    const { target, applied } = fakeTarget([LATE.tag]);
    const report = await runPendingMigrations(target, CHAIN);
    expect(report.outOfOrderTags).toEqual([EARLY.tag]);
    expect(report.appliedTags).toEqual([EARLY.tag]);
    expect(applied).toContain(EARLY.tag);
  });

  it("reports nothing on an ordinary run", async () => {
    const { target } = fakeTarget([]);
    const report = await runPendingMigrations(target, CHAIN);
    expect(report.outOfOrderTags).toEqual([]);
    expect(report.appliedTags).toEqual([EARLY.tag, LATE.tag]);
  });

  it("is measured before the batch lands, while which tag arrived late is still visible", async () => {
    // Measured after, every tag is in the ledger and the answer is always empty.
    const { target } = fakeTarget([LATE.tag]);
    const report = await runPendingMigrations(target, CHAIN);
    expect(report.outOfOrderTags).not.toEqual([]);
  });
});
