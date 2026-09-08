import { describe, expect, it } from "vitest";
import { migrationStatementFailure } from "../src/do-sqlite-migration-target.ts";

/*
 * WHAT A FAILING MIGRATION SAYS.
 *
 * Two outages ran on SQLite's own sentence and nothing else. "FOREIGN KEY constraint failed" is the
 * same string for every migration in a lineage and every statement inside each of them, so it
 * locates nothing — while the runner held the migration and the statement in hand at the moment it
 * threw and discarded both with the error it re-raised.
 *
 * Both are in the message now, ahead of SQLite's sentence, because the fault reaches a reader
 * through a bounded field and the identifying half has to survive the cut.
 */
describe("a failing migration names itself and the statement that failed", () => {
  it("leads with the tag and the statement, then SQLite's own words", () => {
    const migration = {
      tag: "20260906T013304_matter-status-intake-and-consultation",
      statements: [
        "CREATE TABLE a (id TEXT)",
        "DROP TABLE  \n  matter",
        "CREATE INDEX i ON a (id)",
      ],
    };
    const message = migrationStatementFailure(
      migration,
      1,
      new Error("FOREIGN KEY constraint failed"),
    );
    expect(message).toContain("20260906T013304_matter-status-intake-and-consultation");
    expect(message).toContain("statement 2/3");
    // Whitespace collapsed, so a statement wrapped across lines still reads as one phrase.
    expect(message).toContain("[DROP TABLE matter]");
    expect(message).toContain("FOREIGN KEY constraint failed");
    // The identity comes first: a bounded field truncates the tail, never the part that locates it.
    expect(message.indexOf("statement 2/3")).toBeLessThan(
      message.indexOf("FOREIGN KEY constraint failed"),
    );
  });

  it("survives a throw that is not an Error at all", () => {
    const message = migrationStatementFailure(
      { tag: "20260101T000000_example", statements: ["SELECT 1"] },
      0,
      "something threw a string",
    );
    expect(message).toContain("something threw a string");
  });
});
