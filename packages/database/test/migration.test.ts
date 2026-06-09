import { describe, expect, it } from "vitest";
import {
  migrationsFromJournal,
  splitSqlStatements,
  type MigrationJournal,
} from "../src/migration.ts";

describe("splitSqlStatements", () => {
  it("splits on the drizzle statement breakpoint and trims empties", () => {
    const sql = `CREATE TABLE a (id text);\n--> statement-breakpoint\nCREATE INDEX a_index ON a (id);\n`;
    expect(splitSqlStatements(sql)).toEqual([
      "CREATE TABLE a (id text);",
      "CREATE INDEX a_index ON a (id);",
    ]);
  });

  it("returns a single statement when there is no breakpoint", () => {
    expect(splitSqlStatements("CREATE TABLE a (id text);")).toEqual(["CREATE TABLE a (id text);"]);
  });
});

describe("migrationsFromJournal", () => {
  const journal: MigrationJournal = {
    version: "7",
    dialect: "sqlite",
    entries: [
      { idx: 1, version: "6", when: 2, tag: "0001_second", breakpoints: true },
      { idx: 0, version: "6", when: 1, tag: "0000_first", breakpoints: true },
    ],
  };

  it("orders migrations by journal idx and splits each file's statements", () => {
    const migrations = migrationsFromJournal(journal, {
      "0000_first": "CREATE TABLE a (id text);",
      "0001_second":
        "ALTER TABLE a ADD col text;\n--> statement-breakpoint\nCREATE INDEX i ON a (col);",
    });
    expect(migrations.map((migration) => migration.tag)).toEqual(["0000_first", "0001_second"]);
    expect(migrations[1]?.statements).toHaveLength(2);
  });

  it("fails loud when a journal entry has no SQL", () => {
    expect(() =>
      migrationsFromJournal(journal, { "0000_first": "CREATE TABLE a (id text);" }),
    ).toThrow(/0001_second/);
  });
});
