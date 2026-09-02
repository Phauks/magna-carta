/*
 * What a row of the Time Sheet means.
 *
 * The load-bearing rule is that EXISTING and being COMPLETE are two different facts about a row: a
 * row holds what is typed into it from the moment it exists, and what it is still short of is said
 * out loud rather than standing between the person and their typing.
 *
 * The matter is one of those facts and not a condition of the row, because the sheet is firm-wide:
 * a person captures time before they know where it belongs, so a matterless row is legal, holds a
 * provisional code, and says that the matter is one of the things it is waiting for.
 */
import { describe, expect, it } from "vitest";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import {
  NO_MATTER_TEXT,
  clockText,
  decimalHoursText,
  incompleteCount,
  isIncomplete,
  isWorkable,
  matterDisplay,
  matterMatches,
  minutesFromSeconds,
  missingFacts,
  newSheetRow,
  parseDurationSeconds,
  provisionalTimeCode,
  saveStateTitle,
  searchMatches,
  sheetHonesty,
  sheetRowFromEntry,
  type SheetMatter,
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

describe("a row built from the record", () => {
  /*
   * The listing serves far more than a row used to read off it, and every field it dropped came
   * back to the screen as "not recorded yet". This holds the mapping still.
   */
  it("carries every fact the listing answers with", () => {
    const row = sheetRowFromEntry(
      entry({
        entryNumber: "2026-0147.0042",
        memo: "Check the retainer before billing this",
        rateE4: 3_400_000,
        utbmsTaskCodeId: "utbmsCode_l120",
        utbmsActivityCodeId: "utbmsCode_a103",
        attachmentCount: 2,
        createdAt: "2026-08-27T10:30:00.000Z",
        createdByName: "Marcus Reyes",
      }),
    );
    expect(row.entryNumber).toBe("2026-0147.0042");
    expect(row.memo).toBe("Check the retainer before billing this");
    expect(row.rateE4).toBe(3_400_000);
    expect(row.utbmsTaskCodeId).toBe("utbmsCode_l120");
    expect(row.utbmsActivityCodeId).toBe("utbmsCode_a103");
    expect(row.attachmentCount).toBe(2);
    expect(row.enteredAt).toBe("2026-08-27");
    expect(row.enteredByName).toBe("Marcus Reyes");
  });

  it("reads an entry captured before those fields existed without inventing any of them", () => {
    const row = sheetRowFromEntry(entry());
    expect(row.entryNumber).toBeNull();
    expect(row.memo).toBe("");
    expect(row.rateE4).toBeNull();
    expect(row.attachmentCount).toBe(0);
  });
});

/** A row a person has just added on the firm-wide sheet: no matter, and a provisional code. */
function blankRow(): SheetRow {
  return newSheetRow({
    key: "unwritten-1",
    workDate: "2026-08-26",
    matterId: null,
    provisionalCode: provisionalTimeCode(1),
    timekeeperUserId: "user_1",
    timekeeperName: "Rosalind Osei",
    enteredAt: "2026-08-26",
    currency: "USD",
  });
}

/** The same row as it is once somebody has said where the time belongs. */
function filedRow(): SheetRow {
  return { ...blankRow(), matterId: "matter_1" };
}

const MATTERS: readonly SheetMatter[] = [
  { id: "matter_1", matterNumber: "2026-0147", title: "Pemberton v. Hale Construction Co." },
  { id: "matter_2", matterNumber: null, title: "Okafor Holdings, initial consultation" },
];

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

  it("is incomplete, and names EVERY fact it is short of, the matter first", () => {
    expect(missingFacts(blankRow())).toEqual(["a matter", "a description", "a duration"]);
    expect(isIncomplete(blankRow())).toBe(true);
  });

  it("carries a provisional code, so a row nobody has filed still has a name", () => {
    expect(blankRow().provisionalCode).toBe("TMP-0001");
    expect(provisionalTimeCode(114)).toBe("TMP-0114");
  });

  it("starts on the matter the sheet was opened from, and on none when it was not", () => {
    expect(blankRow().matterId).toBeNull();
    expect(filedRow().matterId).toBe("matter_1");
  });

  it("stops being short of a fact as that fact arrives", () => {
    const withDescription = { ...filedRow(), description: "Drafting the demand letter" };
    expect(missingFacts(withDescription)).toEqual(["a duration"]);
    const complete = { ...withDescription, workedSeconds: 1800 };
    expect(missingFacts(complete)).toEqual([]);
    expect(isIncomplete(complete)).toBe(false);
  });

  it("is short of a matter alone once it holds the words and the time", () => {
    const typedInto = {
      ...blankRow(),
      description: "Reviewed the incoming discovery",
      workedSeconds: 1440,
    };
    expect(missingFacts(typedInto)).toEqual(["a matter"]);
  });

  it("does not treat whitespace as a description", () => {
    expect(missingFacts({ ...blankRow(), description: "   " })).toContain("a description");
  });
});

describe("what a row nobody has filed says about itself", () => {
  it("says it is not written, names the matter as the reason, and gives its provisional code", () => {
    const said = saveStateTitle({
      ...blankRow(),
      description: "Reviewed the incoming discovery",
      workedSeconds: 1440,
    });
    expect(said).toContain("Not written to the firm's record yet");
    expect(said).toContain("a matter");
    expect(said).toContain("TMP-0001");
  });

  it("does not read as a save that failed", () => {
    expect(saveStateTitle(blankRow())).not.toContain("failed");
  });
});

describe("naming a matter", () => {
  it("reads as the number and the name together", () => {
    expect(matterDisplay(MATTERS[0] as SheetMatter)).toBe(
      "2026-0147 · Pemberton v. Hale Construction Co.",
    );
  });

  it("reads as the name alone where the matter carries no number yet", () => {
    expect(matterDisplay(MATTERS[1] as SheetMatter)).toBe("Okafor Holdings, initial consultation");
  });

  it("is found by either half, case-blind", () => {
    expect(matterMatches(MATTERS[0] as SheetMatter, "0147")).toBe(true);
    expect(matterMatches(MATTERS[0] as SheetMatter, "pemberton")).toBe(true);
    expect(matterMatches(MATTERS[0] as SheetMatter, "okafor")).toBe(false);
  });

  it("offers everything when nothing is typed", () => {
    expect(MATTERS.every((matter) => matterMatches(matter, "  "))).toBe(true);
  });

  it("gives a row on no matter WORDS rather than a blank, so the column can be filtered by it", () => {
    expect(NO_MATTER_TEXT).toBe("No matter");
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

  it("reaches the row's matter, which on a firm-wide sheet is how a row is found", () => {
    expect(searchMatches(row, "pemberton", "2026-0147 · Pemberton v. Hale Construction Co.")).toBe(
      true,
    );
    expect(searchMatches(row, "0147", "2026-0147 · Pemberton v. Hale Construction Co.")).toBe(true);
  });

  it("reaches a row by the provisional code it is held under", () => {
    expect(searchMatches(blankRow(), "tmp-0001")).toBe(true);
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
