/*
 * THE SAME SHAPES, AS A SQLITE `GLOB` — so the guard on the column and the guard in the code cannot
 * come to different conclusions about what a date is.
 *
 * The storage layer had exactly the fragmentation the code did, and for the same reason. Seven
 * tables — every one of them recently built — check the shape of their civil-date columns; roughly
 * twenty-eight older columns across the ledger, time, costs, billing, trust and the directory do
 * not. Nobody decided that. There was simply nothing shared to point at, so whoever was in the area
 * wrote a guard or did not.
 *
 * WHY GLOB AND NOT A REGEX. SQLite ships `GLOB` in every build; `REGEXP` is a hook the host has to
 * register, and neither D1 nor a Durable Object's SQLite provides one. So the shape has to be
 * expressible in glob syntax, which has character classes and no alternation — hence the wall clock
 * needing two alternatives OR'd rather than one pattern.
 *
 * THESE ARE PROVEN EQUIVALENT TO THE REGEXES, NOT ASSERTED TO BE. test/sql-shape.test.ts runs a
 * corpus through a real SQLite `CHECK` and through the pattern and fails on any value the two
 * disagree about. A glob eyeballed against a regex is how the wall-clock guard already in the schema
 * came to accept 24:00 and 29:59 — see WALL_CLOCK_TIME_GLOBS below.
 *
 * A guard is the LAST line and never the only one: `isCivilDate` also refuses a day that is not on
 * the calendar, which no glob can express (2026-02-30 matches the shape perfectly well). The column
 * check is what stops a repair script, a migration or a route that skipped its validator from
 * writing something no reader can render.
 */

/**
 * The civil-date shape, as glob alternatives. Any one matching is a pass.
 *
 * Exactly `CIVIL_DATE_PATTERN`: a glob is anchored at both ends by construction, so the four-two-two
 * digit run is the whole string or it is not a match.
 */
export const CIVIL_DATE_GLOBS: readonly string[] = Object.freeze([
  "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]",
]);

/**
 * The wall-clock shape, as glob alternatives — TWO of them, and that is the whole point.
 *
 * `WALL_CLOCK_TIME_PATTERN` is `([01]\d|2[0-3]):[0-5]\d`, and the alternation is load-bearing: the
 * hour is 00-19 with any second digit, or 20-23. Glob cannot alternate inside a pattern, so the
 * alternation moves up into the CHECK as an `OR` of two globs.
 *
 * The schema's existing wall-clock guard collapsed it to the single glob `[0-2][0-9]:[0-5][0-9]`,
 * which is not the same shape — it accepts 24:00, 25:10 and 29:59, hours that do not exist. Nothing
 * writes one today, because every write path goes through `isWallClockTime`; what it means is that
 * the backstop is looser than the schema reads as promising. Those columns cannot be tightened in
 * place — adding or narrowing a CHECK is a SQLite table rebuild, and this repository has established
 * that a rebuild of a table other tables point at cannot complete against a firm database holding
 * data (packages/database/src/reviewed-rebuilds.ts). They are recorded where the fitness test can
 * see them instead, and every new column gets this.
 */
export const WALL_CLOCK_TIME_GLOBS: readonly string[] = Object.freeze([
  "[01][0-9]:[0-5][0-9]",
  "2[0-3]:[0-5][0-9]",
]);

/**
 * The globs as one SQL boolean over a column reference, for a caller assembling a CHECK by hand.
 *
 * `column` is interpolated verbatim, so it must be an identifier the caller controls and never a
 * value — this builds schema, not a query. The drizzle-side helpers in
 * packages/database/src/date-shape-checks.ts are what the schema actually uses; this exists for a
 * migration or a probe that has no table object to hand.
 */
export function shapeCheckSql(column: string, globs: readonly string[]): string {
  return globs.map((glob) => `${column} GLOB '${glob}'`).join(" OR ");
}
