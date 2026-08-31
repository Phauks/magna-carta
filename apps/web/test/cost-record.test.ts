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
    disbursementClass: "hard",
    billable: true,
    utbmsExpenseCodeId: "utbmsCode_expense_E115",
    description: "Deposition transcript: Hale project engineer, volumes 1 and 2, expedited",
    status: "approved",
    vendorName: "Battle Born Court Reporters",
    source: "manual",
    recoveryCategory: null,
    ...overrides,
  };
}

const context: CostSheetContext = {
  matterTitle: "Pemberton v. Hale Construction Co.",
  matterNumber: "2026-0147",
  money: (amount) => `$${amount.toFixed(2)}`,
  date: (isoDate) => isoDate,
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
    expect(fieldValue(sheet, "Class")).toBe("Hard");
    expect(fieldValue(sheet, "Billing")).toBe("Recoverable from the client");
    expect(fieldValue(sheet, "Expense Code")).toBe("E115 Deposition Transcripts");
    expect(fieldValue(sheet, "Source")).toBe("Recorded by hand");
  });

  it("keeps a soft cost's absent receipt apart from a hard cost's unserved one", () => {
    expect(
      fieldValue(costEntrySheet(cost({ disbursementClass: "soft" }), context), "Receipt"),
    ).toBe("— (soft cost)");
    expect(fieldValue(costEntrySheet(cost(), context), "Receipt")).toContain(
      COST_LEDGER_GAPS.receipt.waitsOn,
    );
  });

  it("names a fact the listing cannot serve rather than printing a shorter record", () => {
    const sheet = costEntrySheet(cost(), context);
    expect(fieldValue(sheet, "Date Entered")).toContain(COST_LEDGER_GAPS.dateEntered.waitsOn);
    expect(fieldValue(sheet, "Entered By")).toContain(COST_LEDGER_GAPS.enteredBy.waitsOn);
  });

  it("names the invoice only on a cost a bill has taken up", () => {
    expect(fieldValue(costEntrySheet(cost(), context), "Invoice")).toBe("—");
    expect(fieldValue(costEntrySheet(cost({ status: "billed" }), context), "Invoice")).toContain(
      COST_LEDGER_GAPS.invoice.waitsOn,
    );
  });

  it("carries the Info line the client reads, whole", () => {
    const sheet = costEntrySheet(cost(), context);
    const info = sheet.sections.find((section) => section.id === "info");
    expect(info?.kind).toBe("text");
    expect(info?.kind === "text" ? info.text : "").toBe(
      "Deposition transcript: Hale project engineer, volumes 1 and 2, expedited",
    );
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
