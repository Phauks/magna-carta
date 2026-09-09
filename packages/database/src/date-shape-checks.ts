/*
 * The column guards for a civil date and a wall-clock time, built from the platform's own shapes.
 *
 * A schema author writes `civilDateShapeCheck("work_date", table.workDate)` instead of a glob typed
 * out by hand, so the guard on the column and `isCivilDate` in the code cannot come to different
 * conclusions about what a date is. They already had: the wall-clock guard on the four columns that
 * carry one collapsed the pattern's alternation into `[0-2][0-9]:[0-5][0-9]`, which reads like the
 * same shape and accepts 24:00, 25:10 and 29:59.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS RETROFIT. Roughly twenty-eight civil-date columns across the
 * ledger, time, costs, billing, trust and the directory carry no shape guard at all, and the four
 * wall-clock guards that exist are the loose spelling. Both are left exactly as they are, because
 * adding or narrowing a CHECK in SQLite is a table rebuild, and a rebuild of a table other tables
 * point at cannot complete against a firm database that holds data — see reviewed-rebuilds.ts, which
 * names this as an open decision rather than something to work around. test/date-shape-guards.test.ts
 * records every one of them and refuses to let the list grow.
 *
 * A guard is the LAST line, never the only one. No glob can say a day is on the calendar — 2026-02-30
 * matches the shape perfectly — so `isCivilDate` at the write path is what refuses that, and this is
 * what stops a repair script, a migration, or a route that skipped its validator.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { CIVIL_DATE_GLOBS, WALL_CLOCK_TIME_GLOBS } from "@magna-carta/civil-time/sql-shape";

/**
 * One `GLOB` alternative per shape, OR'd, optionally preceded by a null escape.
 *
 * Assembled by folding rather than by joining strings, because the column is a drizzle reference and
 * has to stay one — interpolating its name as text would produce SQL that happens to work and a
 * snapshot that no longer tracks the column.
 */
function shapeCheck(
  column: AnySQLiteColumn,
  globs: readonly string[],
  { nullable }: { nullable: boolean },
): SQL {
  const alternatives = globs.map((glob) => sql`${column} GLOB ${sql.raw(`'${glob}'`)}`);
  const shape = alternatives.reduce((left, right) => sql`${left} OR ${right}`);
  return nullable ? sql`${column} IS NULL OR ${shape}` : shape;
}

/**
 * The column holds `YYYY-MM-DD` and nothing else.
 *
 * `nullable` defaults to false: a guard that silently admitted null on a NOT NULL column would be
 * dead weight, and one that refused it on a nullable column would be a bug, so the caller says.
 */
export function civilDateShape(column: AnySQLiteColumn, nullable = false): SQL {
  return shapeCheck(column, CIVIL_DATE_GLOBS, { nullable });
}

/** The column holds `HH:MM` on a twenty-four-hour clock and nothing else. */
export function wallClockTimeShape(column: AnySQLiteColumn, nullable = false): SQL {
  return shapeCheck(column, WALL_CLOCK_TIME_GLOBS, { nullable });
}
