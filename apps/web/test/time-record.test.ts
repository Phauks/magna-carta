import { civilDateOf } from "@magna-carta/civil-time/civil-date";
/*
 * The time record: what a person may type, what stops a save, and what reaches the paper.
 *
 * The printed sheet gets the most attention here, and deliberately. It is the one artifact on this
 * surface that leaves the firm, so the assertions are about what it does NOT say as much as what it
 * does: no internal text, and no invented entry number standing in for one nothing has issued.
 */
import { describe, expect, it } from "vitest";
import { INTERNAL_ONLY_FIELD_KEYS } from "@magna-carta/design-system/print-sheet/projection";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import { draftRefusal, parseDurationText } from "../src/lib/time/time-operations.ts";
import { timeEntrySheet, type TimeSheetContext } from "../src/lib/time/time-print-sheet.ts";
import { TIME_LEDGER_GAPS, gapCellTitle, gapReason } from "../src/lib/time/time-gaps.ts";

function entry(overrides: Partial<TimeEntrySummary> = {}): TimeEntrySummary {
  return {
    id: "timeEntry_one",
    matterId: "matter_one",
    timekeeperUserId: "user_osei",
    workDate: "2026-08-12",
    durationMinutes: 90,
    rawDurationMinutes: 84,
    narrative: "Reviewed the defect schedule and drafted the response to opposing counsel.",
    billable: true,
    amountMinor: 45_000,
    currency: "USD",
    status: "draft",
    timekeeperName: "R. Osei",
    ...overrides,
  };
}

const context: TimeSheetContext = {
  matterTitle: "Pemberton v. Hale Construction Co.",
  matterNumber: "2026-0147",
  money: (amount) => `$${amount.toFixed(2)}`,
  date: (isoDate) => isoDate,
  // The day an instant fell on, pinned to UTC here so the sheet reads the same on every machine.
  // The real supplier passes formatInstantDate, which reads in the viewer's own zone instead.
  instantDate: (instant) => civilDateOf(instant),
  printedAt: "Aug 30, 2026, 9:00 AM",
};

describe("reading a duration somebody typed", () => {
  it("accepts both literacies, because both are shown", () => {
    expect(parseDurationText("1:30")).toBe(90);
    expect(parseDurationText("1.5")).toBe(90);
    expect(parseDurationText("1.5h")).toBe(90);
    expect(parseDurationText("90m")).toBe(90);
    expect(parseDurationText(" 2 ")).toBe(120);
  });

  it("refuses what is not a duration rather than guessing at it", () => {
    expect(parseDurationText("")).toBeNull();
    expect(parseDurationText("half an hour")).toBeNull();
    // A clock form's minutes field cannot exceed 59; "1:75" is a typo, not 135 minutes.
    expect(parseDurationText("1:75")).toBeNull();
  });
});

describe("what stops a save, before the button is pressed", () => {
  it("names the missing time first, because nothing else can be computed without it", () => {
    expect(draftRefusal({ durationText: "", description: "Drafted the response" })).toBe(
      "Enter the time worked",
    );
    expect(draftRefusal({ durationText: "0:00", description: "Drafted the response" })).toBe(
      "Enter the time worked",
    );
  });

  it("insists on the description, which is the line the client reads", () => {
    expect(draftRefusal({ durationText: "1:30", description: "   " })).toBe("Enter a description.");
  });

  it("lets a complete draft through", () => {
    expect(draftRefusal({ durationText: "1:30", description: "Drafted the response" })).toBeNull();
  });
});

describe("the printed sheet", () => {
  const sheet = timeEntrySheet(entry(), context);

  it("names what the document is, and says the matter beneath it", () => {
    expect(sheet.heading).toBe("Time Entry");
    expect(sheet.subtitle).toBe("Pemberton v. Hale Construction Co. · Matter 2026-0147");
  });

  it("prints the entry's own reference", () => {
    expect(timeEntrySheet(entry({ entryNumber: "2026-0147.0042" }), context).reference).toBe(
      "2026-0147.0042",
    );
  });

  it("says so rather than inventing one, for an entry captured before the sequence existed", () => {
    expect(sheet.reference).toBe("Entry number not recorded");
  });

  it("prints a duration in both literacies, the decimal leading", () => {
    const figures = sheet.sections.find((section) => section.id === "figures");
    expect(figures?.kind).toBe("fields");
    if (figures?.kind !== "fields") throw new Error("figures section missing");
    expect(figures.fields).toEqual([
      { label: "Worked", value: "1.40", secondary: "1:24" },
      { label: "Billed", value: "1.50", secondary: "1:30" },
      { label: "Amount", value: "$450.00" },
    ]);
  });

  it("prints 'no charge' on a non-billable entry rather than a price of nothing", () => {
    const nonBillable = timeEntrySheet(entry({ billable: false, amountMinor: null }), context);
    const figures = nonBillable.sections.find((section) => section.id === "figures");
    if (figures?.kind !== "fields") throw new Error("figures section missing");
    expect(figures.fields.at(-1)).toEqual({ label: "Amount", value: "No charge" });
  });

  it("carries the description whole, because it is what the client is charged against", () => {
    const description = sheet.sections.find((section) => section.id === "description");
    expect(description?.kind).toBe("text");
    if (description?.kind !== "text") throw new Error("description section missing");
    expect(description.text).toBe(entry().narrative);
  });

  it("says nothing internal, and does not even name an internal field", () => {
    const printed = JSON.stringify(sheet).toLowerCase();
    for (const key of INTERNAL_ONLY_FIELD_KEYS) {
      expect(printed).not.toContain(key.toLowerCase());
    }
    expect(printed).not.toContain("internal");
  });

  /*
   * PROVED, NOT PROMISED. The memo is the firm's own note and the sheet is what a client can be
   * handed. This asserts against a real rendered sheet holding a real memo, because "the print
   * sheet does not carry it" is a sentence anybody can write and only a test can keep true.
   */
  it("never carries the internal memo, whatever the memo says", () => {
    const withMemo = timeEntrySheet(
      entry({ memo: "Client disputes this; do not raise it on the call." }),
      context,
    );
    const printed = JSON.stringify(withMemo).toLowerCase();
    expect(printed).not.toContain("do not raise it");
    expect(printed).not.toContain("disputes");
    expect(printed).not.toContain("memo");
  });

  it("carries both dates and both people once the record holds them", () => {
    const facts = timeEntrySheet(
      entry({
        createdAt: "2026-08-13T09:15:00.000Z",
        createdByName: "M. Reyes",
        utbmsActivityCode: "A103",
        utbmsActivityLabel: "Draft/revise",
      }),
      context,
    ).sections.find((section) => section.id === "facts");
    if (facts?.kind !== "fields") throw new Error("facts section missing");
    const labelled = Object.fromEntries(facts.fields.map((field) => [field.label, field.value]));
    expect(labelled["Work Date"]).toBe("2026-08-12");
    expect(labelled["Date Entered"]).toBe("2026-08-13");
    expect(labelled["Timekeeper"]).toBe("R. Osei");
    expect(labelled["Entered By"]).toBe("M. Reyes");
    expect(labelled["Activity"]).toBe("A103 · Draft/revise");
  });

  it("leaves out a fact the record does not hold rather than printing an empty row", () => {
    const facts = sheet.sections.find((section) => section.id === "facts");
    if (facts?.kind !== "fields") throw new Error("facts section missing");
    const labels = facts.fields.map((field) => field.label);
    expect(labels).not.toContain("Date Entered");
    expect(labels).not.toContain("Category");
    expect(labels).not.toContain("Activity");
  });

  it("states who the sheet came from and when it was taken", () => {
    expect(sheet.footer).toBe("Magna Carta · printed Aug 30, 2026, 9:00 AM");
  });
});

describe("the gaps the surface is honest about", () => {
  it("gives every gap a field name and a dependency, so no control invents its own wording", () => {
    for (const [name, gap] of Object.entries(TIME_LEDGER_GAPS)) {
      expect(gap.field.length).toBeGreaterThan(0);
      expect(gap.waitsOn.length).toBeGreaterThan(0);
      // The noun phrase is completed into a sentence elsewhere; it must not already be one.
      expect(gap.waitsOn.endsWith(".")).toBe(false);
      expect(gapReason(name as keyof typeof TIME_LEDGER_GAPS)).toBe(gap.waitsOn);
    }
  });

  it("says the same two things on a cell that the Soon affordance says on a control", () => {
    expect(gapCellTitle("nonBillableCategory")).toBe("Not built yet: the non-billable category.");
  });

  /*
   * The register's whole job is to name what the CONTRACT cannot answer. Eight entries outlived
   * the routes that closed them, so every surface went on refusing fields the server was already
   * serving. This holds the retired ones out.
   */
  it("names nothing the listing already serves", () => {
    const served = [
      "entryNumber",
      "dateEntered",
      "rate",
      "activity",
      "attachments",
      "memo",
      "history",
    ];
    for (const name of served) {
      expect(Object.keys(TIME_LEDGER_GAPS)).not.toContain(name);
    }
  });
});
