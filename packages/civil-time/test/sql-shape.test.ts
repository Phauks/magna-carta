/*
 * The globs and the patterns are the same shape, PROVEN rather than asserted.
 *
 * Every case runs through a real SQLite CHECK and through the regex, and the test fails on any
 * value the two disagree about. A glob compared to a regex by eye is exactly how the wall-clock
 * guard already in the schema came to accept 24:00.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CIVIL_DATE_PATTERN } from "../src/civil-date.ts";
import { CIVIL_DATE_GLOBS, shapeCheckSql, WALL_CLOCK_TIME_GLOBS } from "../src/sql-shape.ts";
import { WALL_CLOCK_TIME_PATTERN } from "../src/wall-clock.ts";

/** Whether a real SQLite CHECK built from the globs admits a value. */
function sqliteAccepts(globs: readonly string[], value: string): boolean {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`CREATE TABLE t (v TEXT CHECK (${shapeCheckSql("v", globs)}))`);
    const insert = database.prepare("INSERT INTO t VALUES (?)");
    try {
      insert.run(value);
      return true;
    } catch {
      return false;
    }
  } finally {
    database.close();
  }
}

/** Values chosen to sit on every boundary the two spellings could disagree about. */
const CIVIL_DATE_CASES = [
  "2026-09-08",
  "0001-01-01",
  "9999-12-31",
  "2026-02-30", // a shape both accept; only isCivilDate rejects the day itself
  "2026-13-45",
  "2026-9-08",
  "26-09-08",
  "2026-09-08T00:00:00.000Z",
  "2026-09-088",
  "x2026-09-08",
  "2026-09-08 ",
  "",
];

const WALL_CLOCK_CASES = [
  "00:00",
  "09:30",
  "19:59",
  "20:00",
  "23:59",
  // The hours that do not exist. The schema's single-glob spelling accepts all three.
  "24:00",
  "25:10",
  "29:59",
  "2:30",
  "09:60",
  "09:30:00",
  "0930",
  "",
];

describe("the civil-date glob is the civil-date pattern", () => {
  it("agrees with the regex on every case, accept and refuse alike", () => {
    for (const value of CIVIL_DATE_CASES) {
      expect(
        sqliteAccepts(CIVIL_DATE_GLOBS, value),
        `SQLite and the pattern differ on "${value}"`,
      ).toBe(CIVIL_DATE_PATTERN.test(value));
    }
  });

  it("admits the shape of a day that is not on the calendar, which only isCivilDate refuses", () => {
    // Stated rather than left implicit: a column check is the last line, never the only one.
    expect(sqliteAccepts(CIVIL_DATE_GLOBS, "2026-02-30")).toBe(true);
  });
});

describe("the wall-clock glob is the wall-clock pattern", () => {
  it("agrees with the regex on every case, accept and refuse alike", () => {
    for (const value of WALL_CLOCK_CASES) {
      expect(
        sqliteAccepts(WALL_CLOCK_TIME_GLOBS, value),
        `SQLite and the pattern differ on "${value}"`,
      ).toBe(WALL_CLOCK_TIME_PATTERN.test(value));
    }
  });

  it("refuses the hours the schema's collapsed single glob lets through", () => {
    // This is the drift this module exists to stop being written again: `[0-2][0-9]:[0-5][0-9]`
    // reads like the same shape and is not.
    for (const impossible of ["24:00", "25:10", "29:59"]) {
      expect(sqliteAccepts(WALL_CLOCK_TIME_GLOBS, impossible), impossible).toBe(false);
      expect(sqliteAccepts(["[0-2][0-9]:[0-5][0-9]"], impossible), impossible).toBe(true);
    }
  });

  it("needs both alternatives — neither alone is the shape", () => {
    expect(sqliteAccepts(["[01][0-9]:[0-5][0-9]"], "23:00")).toBe(false);
    expect(sqliteAccepts(["2[0-3]:[0-5][0-9]"], "09:00")).toBe(false);
    expect(sqliteAccepts(WALL_CLOCK_TIME_GLOBS, "23:00")).toBe(true);
    expect(sqliteAccepts(WALL_CLOCK_TIME_GLOBS, "09:00")).toBe(true);
  });
});

describe("the SQL the globs assemble into", () => {
  it("ORs the alternatives over the one column", () => {
    expect(shapeCheckSql("due_at_time", WALL_CLOCK_TIME_GLOBS)).toBe(
      "due_at_time GLOB '[01][0-9]:[0-5][0-9]' OR due_at_time GLOB '2[0-3]:[0-5][0-9]'",
    );
    expect(shapeCheckSql("work_date", CIVIL_DATE_GLOBS)).toBe(
      "work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'",
    );
  });
});
