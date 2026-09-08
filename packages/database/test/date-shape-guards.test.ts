// @repo-wide-fitness scope=schema — the guard helpers are here, the columns they protect are spread
// across the whole per-firm schema, so the diff that adds an unguarded date column is routinely in a
// package that never touches this file.
/*
 * EVERY COLUMN THAT HOLDS A DAY OR A CLOCK IS CLASSIFIED, and a new one carries the shared guard.
 *
 * The storage layer had exactly the fragmentation the code did. Nineteen columns across seven tables
 * — calendar, notes, tasks, matter assets, every one of them recently built — check the shape of what
 * they hold. Thirty-two older columns across the ledger, time, costs, billing, trust, custody and the
 * directory do not. Nobody decided that; there was nothing shared to point at, so whoever was in the
 * area wrote a guard or did not.
 *
 * THE OLD ONES ARE RECORDED, NOT RETROFITTED, and the reason is not appetite. Adding or narrowing a
 * CHECK in SQLite is a table rebuild, and a rebuild of a table other tables point at cannot complete
 * against a firm database that holds data — src/reviewed-rebuilds.ts carries that finding, names the
 * day a firm's database sat unreachable because of one, and says in as many words that widening a
 * CHECK on a parent table "needs a different answer, and choosing one is an open decision". So this
 * test freezes the gap rather than closing it: the recorded sets may shrink and must never grow.
 *
 * What it therefore buys is the thing that was actually missing — a NEW date column cannot ship
 * unguarded, because the only classification still open to one is the guard itself.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCHEMA = "src/per-firm-schema.ts";
const source = readFileSync(new URL(`../${SCHEMA}`, import.meta.url), "utf8");

/**
 * The schema's own naming convention for a day or a clock: `_date`, `_on`, `_at_time`.
 *
 * A convention rather than a type, because a `text` column is a `text` column — this is the only
 * signal the schema actually carries, and it is why the classification below has to be by hand.
 */
const DATE_SHAPED_NAME = /(_date|_on|_at_time)$/;

interface Column {
  readonly table: string;
  readonly property: string;
  readonly column: string;
}

function dateShapedColumns(): Column[] {
  const lines = source.split("\n");
  const found: Column[] = [];
  let table = "(before any table)";
  for (const line of lines) {
    const declaration = /^export const (\w+) = sqliteTable\(/.exec(line);
    if (declaration) table = declaration[1] ?? table;
    const column = /^\s*(\w+):\s*text\("([a-z_0-9]+)"\)/.exec(line);
    if (column === null) continue;
    const [, property, name] = column as unknown as [string, string, string];
    if (!DATE_SHAPED_NAME.test(name)) continue;
    found.push({ table, property, column: name });
  }
  return found;
}

/** Every column the schema guards through the shared helpers. */
function guardedProperties(): ReadonlySet<string> {
  return new Set([
    ...[...source.matchAll(/civilDateShape\(table\.(\w+)/g)].map((match) => match[1] ?? ""),
    ...[...source.matchAll(/wallClockTimeShape\(table\.(\w+)/g)].map((match) => match[1] ?? ""),
  ]);
}

/**
 * FROZEN. Date and clock columns written before the shared guard existed, which cannot be given one
 * without the parent-table rebuild described above. `table.column`, so two tables' `effective_date`
 * are two entries.
 *
 * This list may SHRINK — a table that is genuinely childless and empty can be rebuilt, and one that
 * is dropped takes its entry with it. It must never grow. A new column belongs in `civilDateShape`.
 */
const UNGUARDED_PREDATING_THE_SHARED_GUARD: ReadonlySet<string> = new Set([
  "ledgerEntry.effective_date",
  "matterCourtCase.filed_on",
  "matterEstate.letters_issued_on",
  "customFieldValue.value_date",
  "timeEntry.work_date",
  "costEntry.incurred_date",
  "conflictsDisposition.waiver_given_on",
  "custodyPacket.review_on",
  "custodyItem.instrument_date",
  "custodyItem.review_on",
  "custodyMovement.due_back_on",
  "trustAccount.opened_on",
  "trustTransfer.effective_date",
  "trustMovement.effective_date",
  "trustDisbursementRequest.effective_date",
  "trustBankStatementLine.posted_on",
  "trustFirmFundsMovement.effective_date",
  "trustUnclaimedFundsReview.observed_earliest_receipt_date",
  "trustUnclaimedFundsReview.observed_last_activity_date",
  "trustUnclaimedFundsContactAttempt.attempted_on",
  "invoice.issue_date",
  "invoice.due_date",
  "invoiceApplication.effective_date",
  "creditNote.effective_date",
  "invoiceDelivery.delivery_date",
  "matterRecovery.recovered_date",
  "matterAsset.acquired_on",
  "matterAsset.disposition_on",
  "matterAssetReceivable.maturity_on",
  "matterAssetEncumbrance.released_on",
  "notificationInAppSuppression.civil_date",
]);

/**
 * FROZEN. Wall-clock columns carrying the guard's LOOSE first spelling, `[0-2][0-9]:[0-5][0-9]`.
 *
 * It reads like the wall-clock shape and is not: it accepts 24:00, 25:10 and 29:59, hours that do
 * not exist. `WALL_CLOCK_TIME_PATTERN` refuses all three and every write path goes through it, so
 * nothing writes one today — what this records is that the BACKSTOP is looser than the schema reads
 * as promising, which is the same drift, one layer down, that put a fixed offset into two packages'
 * zone checks.
 *
 * They cannot be tightened in place, for the parent-rebuild reason in the header. A new wall-clock
 * column takes `wallClockTimeShape`, which carries the pattern's own two alternatives.
 */
const LOOSELY_GUARDED_WALL_CLOCKS: ReadonlySet<string> = new Set([
  "matterEvent.starts_at_time",
  "matterEvent.ends_at_time",
  "matterDeadline.due_at_time",
  "matterNote.occurred_at_time",
  "matterTask.due_at_time",
  "firmEvent.starts_at_time",
  "firmEvent.ends_at_time",
  "firmResourceBooking.starts_at_time",
  "firmResourceBooking.ends_at_time",
]);

/**
 * FROZEN. Columns the naming convention catches that hold something other than a day or a clock,
 * each with what it actually holds — so the next reader does not have to work it out again.
 */
const NOT_A_DAY_OR_A_CLOCK: ReadonlyMap<string, string> = new Map([
  [
    "reviewDocument.sort_date",
    "a canonical INSTANT — the sent time for email, the best available internal date otherwise — " +
      "not a civil date, despite the name. A privilege log is a function over it, so it sorts as " +
      "text and carries the instant shape rather than the day shape",
  ],
]);

describe("every column that holds a day or a clock is classified", () => {
  const columns = dateShapedColumns();
  const guarded = guardedProperties();

  it("finds the schema's date-shaped columns at all", () => {
    // A scan that silently found nothing is the failure this whole file exists to prevent. The
    // count is not pinned — it moves with the schema — but an empty answer means the convention or
    // the column syntax changed under the scan, and it should be repointed rather than deleted.
    expect(columns.length).toBeGreaterThan(40);
    expect(guarded.size).toBeGreaterThan(0);
  });

  it("leaves no date-shaped column unaccounted for", () => {
    const unaccounted = columns.filter(
      (one) =>
        !guarded.has(one.property) &&
        !UNGUARDED_PREDATING_THE_SHARED_GUARD.has(`${one.table}.${one.column}`) &&
        !LOOSELY_GUARDED_WALL_CLOCKS.has(`${one.table}.${one.column}`) &&
        !NOT_A_DAY_OR_A_CLOCK.has(`${one.table}.${one.column}`),
    );
    expect(
      unaccounted.map((one) => `${one.table}.${one.column}`),
      "A date-shaped column is neither guarded nor classified. If it holds a civil date or a " +
        'wall-clock time, guard it: `check("<table>_<column>_shape_check", civilDateShape(' +
        "table.<property>))` from src/date-shape-checks.ts, nullable as the column is. If it holds " +
        "something else, say what in NOT_A_DAY_OR_A_CLOCK. The list of unguarded columns is closed " +
        "and is not an option for anything new — see the header.",
    ).toEqual([]);
  });

  it("keeps both recorded lists honest — an entry that names no column fails", () => {
    const present = new Set(columns.map((one) => `${one.table}.${one.column}`));
    const gone = [
      ...[...UNGUARDED_PREDATING_THE_SHARED_GUARD].filter((entry) => !present.has(entry)),
      ...[...LOOSELY_GUARDED_WALL_CLOCKS].filter((entry) => !present.has(entry)),
      ...[...NOT_A_DAY_OR_A_CLOCK.keys()].filter((entry) => !present.has(entry)),
    ];
    expect(
      gone,
      "A recorded entry names a column the schema no longer has. Drop it — a stale record makes " +
        "the gap read larger than it is, and the whole point of the list is that it only shrinks.",
    ).toEqual([]);
  });

  it("has not let the recorded gap grow", () => {
    // The number the shared guard landed with. It may fall; a rise means a new column took the
    // escape hatch instead of the guard, which is the one thing this file is here to stop.
    expect(UNGUARDED_PREDATING_THE_SHARED_GUARD.size).toBeLessThanOrEqual(31);
  });
});

describe("a guard is built from the shared shape, never typed out", () => {
  it("leaves no hand-written civil-date glob in the schema", () => {
    const handWritten = source.includes("GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'");
    expect(
      handWritten,
      "A civil-date glob is written out in the schema. Use `civilDateShape(table.<property>)` so " +
        "the column and `isCivilDate` cannot drift apart — which is exactly what happened to the " +
        "wall-clock guard recorded below.",
    ).toBe(false);
  });

  it("leaves exactly the recorded loose wall-clock guards, and no more", () => {
    // The set names them; this counts the spelling in the source, so neither a new one nor a
    // quietly deleted record can pass. It may fall together with the set; it must not rise.
    const loose = [...source.matchAll(/GLOB '\[0-2\]\[0-9\]:\[0-5\]\[0-9\]'/g)];
    expect(
      loose.length,
      "The loose wall-clock spelling appears a different number of times than LOOSELY_GUARDED_" +
        "WALL_CLOCKS records. A new wall-clock column takes `wallClockTimeShape(table.<property>)`, " +
        "which is the pattern's own two alternatives rather than a single class admitting an hour " +
        "past 23; a removed one comes out of the set too.",
    ).toBe(LOOSELY_GUARDED_WALL_CLOCKS.size);
  });
});
