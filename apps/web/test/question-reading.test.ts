import { describe, expect, it } from "vitest";
import {
  daysValue,
  readAnything,
  readQuestion,
  understoodChips,
} from "$lib/search/question-reading.ts";
import { MATTERS_PLACE } from "$lib/search/search-address.ts";

// Monday, November 16, 2026: every relative day below is counted from it.
const TODAY = "2026-11-16";

function read(question: string) {
  return readQuestion(question, TODAY);
}

describe("a question read into words, a place, the reader's matters and days", () => {
  it("reads the example the owner picked the chips on", () => {
    expect(read("hargrove unpaid invoices since june")).toEqual({
      words: "hargrove unpaid",
      place: "billing",
      mine: false,
      days: { from: "2026-06-01" },
    });
  });

  it("leaves a question it reads nothing from exactly as typed", () => {
    const reading = read("notice of the easement for Hargrove");
    // "notice" is no place, and with nothing read not even a joining word is taken out.
    expect(reading).toEqual({
      words: "notice of the easement for Hargrove",
      place: null,
      mine: false,
      days: null,
    });
    expect(readAnything(reading)).toBe(false);
  });

  it("takes out the joining words only once something was read", () => {
    expect(read("show me the notes about the easement").words).toBe("easement");
  });
});

describe("a place", () => {
  it("is read where the question names exactly one", () => {
    expect(read("calls with Ruth").place).toBe("communications");
    expect(read("time entries for the deposition").place).toBe("time");
    expect(read("custody packets deed").place).toBe("custody");
    expect(read("cases Linden").place).toBe(MATTERS_PLACE);
  });

  it("is not read where the question names two, and both words stay", () => {
    expect(read("notes and calls about Linden")).toEqual({
      words: "notes and calls about Linden",
      place: null,
      mine: false,
      days: null,
    });
  });

  it("is never read from inside quotation marks", () => {
    expect(read('"notes" easement')).toEqual({
      words: '"notes" easement',
      place: null,
      mine: false,
      days: null,
    });
  });
});

describe("the reader's own matters", () => {
  it("is read from my matters, my cases and mine", () => {
    expect(read("easement on my matters")).toMatchObject({ mine: true, words: "easement" });
    expect(read("my cases deposition")).toMatchObject({ mine: true, words: "deposition" });
    expect(read("mine easement")).toMatchObject({ mine: true, words: "easement" });
  });
});

describe("days", () => {
  it("reads a month after since as the most recent one", () => {
    expect(read("easement since june").days).toEqual({ from: "2026-06-01" });
    // December has not come by November 16, so it is last December.
    expect(read("easement since december").days).toEqual({ from: "2025-12-01" });
  });

  it("does not read a lone month with no word in front, because may is a word", () => {
    expect(read("may easement")).toMatchObject({ days: null, words: "may easement" });
    expect(read("march deadline")).toMatchObject({ days: null });
  });

  it("reads a month beside a year, and a written day, with no word in front", () => {
    expect(read("easement march 2026").days).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(read("easement 2026-06-05").days).toEqual({ from: "2026-06-05", to: "2026-06-05" });
    expect(read("easement june 5, 2026").days).toEqual({ from: "2026-06-05", to: "2026-06-05" });
    expect(read("easement 6/5/2026").days).toEqual({ from: "2026-06-05", to: "2026-06-05" });
  });

  it("does not read a matter number or a lone year as days", () => {
    expect(read("2026-0142 easement").days).toBeNull();
    expect(read("2025 easement").days).toBeNull();
  });

  it("reads a year after a word that makes it one", () => {
    expect(read("easement in 2025").days).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(read("easement before 2025").days).toEqual({ to: "2024-12-31" });
    expect(read("easement after 2025").days).toEqual({ from: "2026-01-01" });
  });

  it("reads named spans counted from the reader's own today", () => {
    expect(read("easement today").days).toEqual({ from: TODAY, to: TODAY });
    expect(read("easement yesterday").days).toEqual({ from: "2026-11-15", to: "2026-11-15" });
    expect(read("easement this week").days).toEqual({ from: "2026-11-16", to: TODAY });
    expect(read("easement last week").days).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(read("easement this month").days).toEqual({ from: "2026-11-01", to: TODAY });
    expect(read("easement last month").days).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(read("easement last year").days).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(read("easement last 30 days").days).toEqual({ from: "2026-10-18", to: TODAY });
  });

  it("reads a span between two days, and from one day to another", () => {
    expect(read("easement between may 1 and june 30").days).toEqual({
      from: "2026-05-01",
      to: "2026-06-30",
    });
    expect(read("easement from march 2026 to june 2026").days).toEqual({
      from: "2026-03-01",
      to: "2026-06-30",
    });
  });

  it("refuses a day that does not exist", () => {
    expect(read("easement 2/30/2026").days).toBeNull();
    expect(read("easement since feb 30").days).toBeNull();
  });
});

describe("the chips under the field", () => {
  const base = {
    today: TODAY,
    placeName: (place: string) => (place === "billing" ? "Billing" : place),
    formatDay: (day: string) => day,
  };

  it("shows each reading the question made that the address still carries", () => {
    const chips = understoodChips({
      ...base,
      asked: "invoices on my matters since june",
      place: "billing",
      mine: true,
      days: { from: "2026-06-01" },
    });
    expect(chips.map((chip) => [chip.key, chip.value])).toEqual([
      ["place", "Billing"],
      ["mine", "My Matters"],
      ["days", "Since 2026-06-01"],
    ]);
  });

  it("shows no chip for a place the reader chose by hand", () => {
    const chips = understoodChips({
      ...base,
      asked: "easement since june",
      place: "notes",
      mine: false,
      days: { from: "2026-06-01" },
    });
    expect(chips.map((chip) => chip.key)).toEqual(["days"]);
  });

  it("shows days an address carries however it was reached, because days have no other control", () => {
    const chips = understoodChips({
      ...base,
      asked: null,
      place: "all",
      mine: false,
      days: { to: "2026-06-30" },
    });
    expect(chips).toEqual([{ key: "days", label: "Date", value: "Through 2026-06-30" }]);
  });

  it("writes one day once, and a span as its two ends", () => {
    const day = (value: string) => value;
    expect(daysValue({ from: "2026-06-05", to: "2026-06-05" }, day)).toBe("2026-06-05");
    expect(daysValue({ from: "2026-06-01", to: "2026-06-30" }, day)).toBe(
      "2026-06-01 to 2026-06-30",
    );
  });
});
