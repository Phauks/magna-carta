import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEK_STARTS_ON,
  calendarWeekStartsOnDefinition,
  readCalendarWeekStartsOn,
  writeCalendarWeekStartsOnStatement,
} from "../src/settings.ts";
import { migratedDatabase } from "./support.ts";

describe("the week-start setting", () => {
  it("reads Sunday where the firm has never set it", async () => {
    const { database } = migratedDatabase();
    expect(await readCalendarWeekStartsOn(database)).toBe(DEFAULT_WEEK_STARTS_ON);
    expect(DEFAULT_WEEK_STARTS_ON).toBe(0);
  });

  it("reads back what the firm set, and overwrites in place", async () => {
    const { database } = migratedDatabase();
    await writeCalendarWeekStartsOnStatement(database, 1, "2026-09-02T12:00:00.000Z").run();
    expect(await readCalendarWeekStartsOn(database)).toBe(1);
    await writeCalendarWeekStartsOnStatement(database, 0, "2026-09-02T12:01:00.000Z").run();
    expect(await readCalendarWeekStartsOn(database)).toBe(0);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM setting WHERE key = ?1")
      .bind(calendarWeekStartsOnDefinition.key)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it("refuses a day the vocabulary does not carry, and reads a corrupt row as the default", async () => {
    const { database, raw } = migratedDatabase();
    expect(() =>
      writeCalendarWeekStartsOnStatement(database, 3 as never, "2026-09-02T12:00:00.000Z"),
    ).toThrow();
    raw.exec(
      `INSERT INTO setting (key, value, updated_at) VALUES ('${calendarWeekStartsOnDefinition.key}', '"wednesday"', '2026-09-02T12:00:00.000Z')`,
    );
    expect(await readCalendarWeekStartsOn(database)).toBe(DEFAULT_WEEK_STARTS_ON);
  });
});
