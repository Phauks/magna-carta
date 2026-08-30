/*
 * What a row of the Time Sheet means.
 *
 * The load-bearing rule is that EXISTING and being COMPLETE are two different facts about a row: a
 * row holds what is typed into it from the moment it exists, and what it is still short of is said
 * out loud rather than standing between the person and their typing.
 */
import { describe, expect, it } from "vitest";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import {
  clockText,
  decimalHoursText,
  incompleteCount,
  isIncomplete,
  isWorkable,
  minutesFromSeconds,
  missingFacts,
  newSheetRow,
  parseDurationSeconds,
  saveStateTitle,
  searchMatches,
  sheetHonesty,
  sheetRowFromEntry,
  type SheetRow,
} from "../src/lib/time/time-sheet-model.ts";

function entry(overrides: Partial<TimeEntrySummary> = {}): TimeEntrySummary {
  return {
    id: "timeEntry_1",
    matterId: "matter_1",
    timekeeperUserId: "user_1",
    workDate: "2026-08-26",
    durationMinutes: 90,
    rawDurationMinutes: 88,
    narrative: "Reviewed the answer and the counterclaim",
    billable: true,
    amountMinor: 51000,
    currency: "USD",
    status: "draft",
    timekeeperName: "Rosalind Osei",
    ...overrides,
  };
}

function blankRow(): SheetRow {
  return newSheetRow({
    key: "unwritten-1",
    workDate: "2026-08-26",
    timekeeperUserId: "user_1",
    timekeeperName: "Rosalind Osei",
    currency: "USD",
  });
}

describe("a row read off the record", () => {
  it("keeps BOTH durations, because the difference between them is where rounding shows", () => {
    const row = sheetRowFromEntry(entry());
    expect(row.workedSeconds).toBe(88 * 60);
    expect(row.billedMinutes).toBe(90);
  });

  it("arrives saved, with an identity", () => {
    const row = sheetRowFromEntry(entry());
    expect(row.saveState).toBe("saved");
    expect(row.entryIdentifier).toBe("timeEntry_1");
  });
});

describe("a fresh row", () => {
  it("exists before it has an identity, and says it is not written yet", () => {
    const row = blankRow();
    expect(row.entryIdentifier).toBeNull();
    expect(row.saveState).toBe("unsaved");
    expect(saveStateTitle(row)).toContain("Not written");
  });

  it("is incomplete, and names EVERY fact it is short of", () => {
    expect(missingFacts(blankRow())).toEqual(["a description", "a duration"]);
    expect(isIncomplete(blankRow())).toBe(true);
  });

  it("stops being short of a fact as that fact arrives", () => {
    const withDescription = { ...blankRow(), description: "Drafting the demand letter" };
    expect(missingFacts(withDescription)).toEqual(["a duration"]);
    const complete = { ...withDescription, workedSeconds: 1800 };
    expect(missingFacts(complete)).toEqual([]);
    expect(isIncomplete(complete)).toBe(false);
  });

  it("does not treat whitespace as a description", () => {
    expect(missingFacts({ ...blankRow(), description: "   " })).toContain("a description");
  });
});

describe("what a saved-and-incomplete row says about itself", () => {
  it("names what it is waiting for, and that it stays until it is completed", () => {
    const row: SheetRow = { ...sheetRowFromEntry(entry({ narrative: "" })), saveState: "saved" };
    const said = saveStateTitle(row);
    expect(said).toContain("a description");
    expect(said).toContain("until it is completed");
  });

  it("says nothing more than saved once it is complete", () => {
    expect(saveStateTitle(sheetRowFromEntry(entry()))).toBe("Saved.");
  });
});

describe("durations in both literacies", () => {
  it("reads a clock", () => {
    expect(parseDurationSeconds("1:30")).toBe(5400);
  });

  it("reads a decimal as the SAME quantity", () => {
    expect(parseDurationSeconds("1.5")).toBe(parseDurationSeconds("1:30"));
  });

  it("reads bare minutes", () => {
    expect(parseDurationSeconds("45m")).toBe(2700);
  });

  it("reads a clock down to the second", () => {
    expect(parseDurationSeconds("1:30:30")).toBe(5430);
  });

  it("answers nothing for what is not a duration", () => {
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds("later")).toBeNull();
  });

  it("writes a clock, to the second only while something is ticking", () => {
    expect(clockText(5430, false)).toBe("1:30");
    expect(clockText(5430, true)).toBe("1:30:30");
  });

  it("writes the decimal the arithmetic multiplies", () => {
    expect(decimalHoursText(90)).toBe("1.5");
  });

  it("rounds seconds to the minute the write is in", () => {
    expect(minutesFromSeconds(89)).toBe(1);
    expect(minutesFromSeconds(5400)).toBe(90);
  });
});

describe("searching the rows in view", () => {
  const row = sheetRowFromEntry(entry());

  it("reaches everything when nothing is typed", () => {
    expect(searchMatches(row, "")).toBe(true);
  });

  it("reaches the description and the person, case-blind", () => {
    expect(searchMatches(row, "COUNTERCLAIM")).toBe(true);
    expect(searchMatches(row, "rosalind")).toBe(true);
  });

  it("does not reach what is not there", () => {
    expect(searchMatches(row, "deposition")).toBe(false);
  });
});

describe("the honesty strip", () => {
  it("adds up what is in the range", () => {
    const figures = sheetHonesty([
      sheetRowFromEntry(entry()),
      sheetRowFromEntry(entry({ id: "timeEntry_2", rawDurationMinutes: 30, durationMinutes: 30 })),
    ]);
    expect(figures.workedSeconds).toBe((88 + 30) * 60);
    expect(figures.billedMinutes).toBe(120);
    expect(figures.amountMinor).toBe(102000);
  });

  it("counts a void toward NOTHING, on the same rule the ledger follows", () => {
    const figures = sheetHonesty([
      sheetRowFromEntry(entry()),
      sheetRowFromEntry(entry({ id: "timeEntry_2", status: "void" })),
    ]);
    expect(figures.billedMinutes).toBe(90);
    expect(figures.amountMinor).toBe(51000);
  });

  it("counts the incomplete rows where the reader cannot miss them", () => {
    const figures = sheetHonesty([sheetRowFromEntry(entry({ narrative: "" })), blankRow()]);
    expect(figures.incompleteRows).toBe(2);
    expect(incompleteCount([sheetRowFromEntry(entry())])).toBe(0);
  });
});

describe("what may still be typed into", () => {
  it("opens a draft and closes everything past it", () => {
    expect(isWorkable(sheetRowFromEntry(entry({ status: "draft" })))).toBe(true);
    for (const status of ["submitted", "approved", "billed", "void"] as const) {
      expect(isWorkable(sheetRowFromEntry(entry({ status })))).toBe(false);
    }
  });
});
