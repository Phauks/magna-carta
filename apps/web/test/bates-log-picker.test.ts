import { describe, expect, it } from "vitest";
import type { BatesLogSummary } from "../src/lib/bates/bates-api.ts";
import { newLogProblems, openingChoice } from "../src/lib/bates/bates-log-picker.svelte";

function log(
  id: string,
  name: string,
  prefix: string,
  digits = 6,
  nextNumber = 1,
): BatesLogSummary {
  return {
    id: id as BatesLogSummary["id"],
    name,
    prefix,
    digits,
    nextNumber,
    rangeCount: nextNumber > 1 ? 1 : 0,
    pagesStamped: nextNumber - 1,
    lastStampedAt: null,
    createdAt: "2026-11-20T00:00:00.000Z",
  };
}

const recent = log("batesLog_aaaaaaaaaaaaaaaaaaaaa", "Production", "SMITH-", 7, 41);
const older = log("batesLog_bbbbbbbbbbbbbbbbbbbbb", "Trial Exhibits", "SMITH-", 6, 9);

describe("openingChoice", () => {
  it("opens on the most recent log when no name is preferred", () => {
    expect(openingChoice([recent, older], null, "Bates Numbers")).toEqual({
      kind: "log",
      log: recent,
    });
  });

  it("opens on the log with the preferred name", () => {
    expect(openingChoice([recent, older], "Trial Exhibits", "Trial Exhibits")).toEqual({
      kind: "log",
      log: older,
    });
  });

  it("offers a new log named for the preference, with the latest log's prefix and padding", () => {
    expect(openingChoice([recent, older], "Motion", "Motion")).toEqual({
      kind: "new",
      name: "Motion",
      prefix: "SMITH-",
      digits: 7,
    });
  });

  it("offers a new log on a matter with none", () => {
    expect(openingChoice([], null, "Bates Numbers")).toEqual({
      kind: "new",
      name: "Bates Numbers",
      prefix: "",
      digits: 6,
    });
  });
});

describe("newLogProblems", () => {
  it("finds nothing wrong with a chosen log", () => {
    expect(newLogProblems({ kind: "log", log: recent }, [recent])).toEqual({});
  });

  it("refuses a blank name and a name another log has", () => {
    expect(
      newLogProblems({ kind: "new", name: "  ", prefix: "", digits: 6 }, [recent]).name,
    ).toBeDefined();
    expect(
      newLogProblems({ kind: "new", name: "Production ", prefix: "", digits: 6 }, [recent]).name,
    ).toBeDefined();
  });

  it("allows a prefix another log already uses", () => {
    expect(
      newLogProblems({ kind: "new", name: "Motion", prefix: "SMITH-", digits: 6 }, [recent]),
    ).toEqual({});
  });

  it("refuses a padding outside 1 to 12", () => {
    expect(
      newLogProblems({ kind: "new", name: "Motion", prefix: "", digits: 13 }, []).digits,
    ).toBeDefined();
    expect(
      newLogProblems({ kind: "new", name: "Motion", prefix: "", digits: 0 }, []).digits,
    ).toBeDefined();
  });
});
