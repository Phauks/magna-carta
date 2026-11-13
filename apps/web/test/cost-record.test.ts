import { civilDateOf } from "@magna-carta/civil-time/civil-date";
/*
 * The cost record on paper: what reaches the sheet, and what deliberately does not.
 *
 * The printed sheet is the one artifact on this surface that leaves the firm, so the assertions are
 * about what it does NOT say as much as what it does: no internal memo, no invented entry number
 * standing in for one nothing has issued, and no silent shortening of the record — a fact the
 * listing cannot serve is named on the paper rather than dropped from it.
 */
import { describe, expect, it } from "vitest";
import {
  INTERNAL_ONLY_FIELD_KEYS,
  printSheetTextContent,
} from "@magna-carta/design-system/print-sheet/projection";
import type { CostLedgerEntry } from "../src/lib/costs/cost-operations.ts";
import { costEntrySheet, type CostSheetContext } from "../src/lib/costs/cost-print-sheet.ts";
import { COST_LEDGER_GAPS } from "../src/lib/costs/cost-gaps.ts";

function cost(overrides: Partial<CostLedgerEntry> = {}): CostLedgerEntry {
  return {
    id: "costEntry_one",
    matterId: "matter_one",
    vendorId: "directory_battleborn",
    incurredDate: "2026-08-05",
    amountMinor: 184_250,
    currency: "USD",
    // The listing still answers this field and nothing on the sheet reads it.
    disbursementClass: "hard",
    billable: true,
    utbmsExpenseCodeId: "utbmsCode_expense_E115",
    description: "Deposition transcript: Hale project engineer, volumes 1 and 2, expedited",
    status: "approved",
    vendorName: "Battle Born Court Reporters",
    source: "manual",
    recoveryCategory: null,
    // Written down nine days after the money went out, deliberately: the two dates on a cost are
    // different facts, and a fixture where they agree cannot tell whether the sheet confused them.
    createdAt: "2026-08-14T16:20:00.000Z",
    createdByUserId: "user_paralegal",
    createdByName: "Imogen Vance",
    kickBackReason: null,
    ...overrides,
  };
}

const context: CostSheetContext = {
  // The day a moment fell on. Pinned here so the sheet reads the same on every machine; the real
  // supplier passes formatInstantDate, which follows the reader's own zone.
  instantDate: (instant: string) => civilDateOf(instant),
  matterTitle: "Pemberton v. Hale Construction Co.",
  matterNumber: "2026-0147",
  money: (amount) => `$${amount.toFixed(2)}`,
  date: (isoDate) => isoDate,
  instant: (isoInstant) => isoInstant,
  printedAt: "Aug 24, 2026, 2:02 PM",
  expenseCodeLabels: () => "Deposition Transcripts",
  source: "manual",
};

function fieldValue(sheet: ReturnType<typeof costEntrySheet>, label: string): string | undefined {
  for (const section of sheet.sections) {
    if (section.kind !== "fields") continue;
    const found = section.fields.find((field) => field.label === label);
    if (found !== undefined) return found.value;
  }
  return undefined;
}

describe("one cost's printed sheet", () => {
  it("names the document, the record's own reference and what it belongs to, once each", () => {
    const sheet = costEntrySheet(cost(), context);
    expect(sheet.heading).toBe("Cost Entry");
    expect(sheet.subtitle).toBe("Pemberton v. Hale Construction Co. · Matter 2026-0147");
    // No number was ever issued, so the sheet says so rather than printing one it invented.
    expect(sheet.reference).toBe(`${COST_LEDGER_GAPS.entryNumber.field} not yet recorded`);
  });

  it("drops the matter number from the subtitle rather than printing an empty one", () => {
    const sheet = costEntrySheet(cost(), { ...context, matterNumber: null });
    expect(sheet.subtitle).toBe("Pemberton v. Hale Construction Co.");
  });

  it("states the facts a cost is, in the cost's own vocabulary", () => {
    const sheet = costEntrySheet(cost(), context);
    expect(fieldValue(sheet, "Status")).toBe("Approved");
    expect(fieldValue(sheet, "Payee")).toBe("Battle Born Court Reporters");
    expect(fieldValue(sheet, "Amount")).toBe("$1842.50");
    expect(fieldValue(sheet, "Billing")).toBe("Billable");
    expect(fieldValue(sheet, "Expense Code")).toBe("E115 Deposition Transcripts");
    expect(fieldValue(sheet, "Source")).toBe("Recorded by hand");
  });

  it("names no hard/soft class: the distinction does not exist on the record", () => {
    const labels = costEntrySheet(cost(), context).sections.flatMap((section) =>
      section.kind === "fields" ? section.fields.map((field) => field.label) : [],
    );
    expect(labels).not.toContain("Class");
  });

  it("does not claim a cost has no files when the listing never said", () => {
    expect(fieldValue(costEntrySheet(cost(), context), "Attachments")).toContain(
      COST_LEDGER_GAPS.attachments.waitsOn,
    );
  });

  it("prints the entered date and the recorder as themselves, not as the incurred date", () => {
    const sheet = costEntrySheet(cost(), context);
    expect(fieldValue(sheet, "Date Incurred")).toBe("2026-08-05");
    expect(fieldValue(sheet, "Date Entered")).toBe("2026-08-14T16:20:00.000Z");
    expect(fieldValue(sheet, "Entered By")).toBe("Imogen Vance");
  });

  it("says a recorder has left rather than printing an identifier at somebody", () => {
    const departed = cost({ createdByName: null });
    expect(fieldValue(costEntrySheet(departed, context), "Entered By")).toBe(
      "No longer at the firm",
    );
    const unrecorded = cost({ createdByUserId: null, createdByName: null });
    expect(fieldValue(costEntrySheet(unrecorded, context), "Entered By")).toBe("Not recorded");
  });

  it("names the invoice only on a cost a bill has taken up", () => {
    expect(fieldValue(costEntrySheet(cost(), context), "Invoice")).toBe("—");
    expect(
      fieldValue(
        costEntrySheet(cost({ status: "billed", invoiceId: "invoice_9" }), context),
        "Invoice",
      ),
    ).toBe("invoice_9");
  });

  it("does not pretend a cost billed before the reference existed has one", () => {
    expect(
      fieldValue(costEntrySheet(cost({ status: "billed", invoiceId: null }), context), "Invoice"),
    ).toContain("isn't linked");
  });

  it("carries the Description the client reads, whole", () => {
    const sheet = costEntrySheet(cost(), context);
    const description = sheet.sections.find((section) => section.id === "description");
    expect(description?.kind).toBe("text");
    expect(description?.kind === "text" ? description.text : "").toBe(
      "Deposition transcript: Hale project engineer, volumes 1 and 2, expedited",
    );
    expect(description?.kind === "text" ? description.title : "").toBe("Description");
  });

  it("puts no internal text on the paper at all", () => {
    const text = printSheetTextContent(costEntrySheet(cost(), context)).join("\n").toLowerCase();
    for (const key of INTERNAL_ONLY_FIELD_KEYS) {
      expect(text).not.toContain(key.toLowerCase());
    }
    expect(text).not.toContain("memo");
  });

  it("says where the sheet came from and when it was taken", () => {
    expect(costEntrySheet(cost(), context).footer).toBe(
      "Magna Carta · printed Aug 24, 2026, 2:02 PM",
    );
  });
});
