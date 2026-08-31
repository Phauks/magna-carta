/*
 * The Cost ledger's model, pinned.
 *
 * Each case below is a place where a quiet mistake would look right on screen and be wrong in a way
 * somebody would act on: a payee whose four honest states collapse into one blank, a void counted
 * into a total, a figure whose scope silently changed under a filter, a soft cost carrying a payee
 * it cannot have, an absorbed cost read as revenue, or a column dropped rather than being honest
 * that its value is not served.
 */
import { describe, expect, it } from "vitest";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { CostSummary } from "../src/lib/matters/cost-api.ts";
import {
  COST_COLUMN_IDENTIFIERS,
  UNSERVED_COST_COLUMNS,
  costLedgerColumns,
  expenseCodeFromIdentifier,
  expenseCodeText,
  isUnservedColumn,
  receiptText,
  unservedCellTitle,
} from "../src/lib/costs/cost-columns.ts";
import {
  countable,
  footerFigures,
  ledgerCurrency,
  matterCostSummary,
  selectionSummary,
  submittedCount,
} from "../src/lib/costs/cost-figures.ts";
import { COST_LEDGER_GAPS, gapCellTitle, gapReason } from "../src/lib/costs/cost-gaps.ts";
import {
  billingLabel,
  billingSentence,
  countsInTotals,
  payeeState,
  payeeText,
  sourceLabel,
} from "../src/lib/costs/cost-vocabulary.ts";
import type { CostLedgerEntry } from "../src/lib/costs/cost-operations.ts";
import { costDraftRefusal, parseAmountMinor } from "../src/lib/costs/cost-operations.ts";
import { costRecordMenu, type CostMenuRecord } from "../src/lib/costs/cost-record-menu.ts";
import { isEnabled, menuItem } from "../src/lib/records/record-menu-model.ts";

function cost(overrides: Partial<CostLedgerEntry> = {}): CostLedgerEntry {
  return {
    id: "costEntry_one",
    matterId: "matter_one",
    vendorId: "directory_clerk",
    incurredDate: "2026-06-30",
    amountMinor: 27_000,
    currency: "USD",
    disbursementClass: "hard",
    billable: true,
    utbmsExpenseCodeId: "utbmsCode_expense_E112",
    description: "Complaint filing fee, Eighth Judicial District Court",
    status: "approved",
    vendorName: "Eighth Judicial District Court Clerk",
    source: "manual",
    recoveryCategory: null,
    ...overrides,
  };
}

const noLabels = (): string | null => null;
const word = (status: CostSummary["status"]) => statusEntry(status).label;
const columns = costLedgerColumns({ currency: "USD", expenseCodeLabels: noLabels });
const columnById = (identifier: string) => {
  const found = columns.find((column) => column.id === identifier);
  if (found === undefined) throw new Error(`no column ${identifier}`);
  return found;
};

describe("the ledger's columns", () => {
  it("keeps every column the design names, including the ones nothing fills yet", () => {
    expect(columns.map((column) => column.label)).toEqual([
      "Date",
      "Entry Number",
      "Date Entered",
      "Entered By",
      "Payee",
      "Info",
      "Class",
      "Expense Code",
      "Receipt",
      "Amount",
      "Billing",
      "Status",
    ]);
  });

  it("has no Hours and no Rate: a cost is an exact amount, so the difference is a missing column", () => {
    const identifiers = columns.map((column) => column.id);
    expect(identifiers).not.toContain("hours");
    expect(identifiers).not.toContain("rate");
    expect(identifiers).not.toContain("worked");
  });

  it("anchors on the date and sums only the amount", () => {
    expect(columnById(COST_COLUMN_IDENTIFIERS.incurredDate).anchored).toBe(true);
    expect(columns.filter((column) => column.total === "sum").map((column) => column.id)).toEqual([
      COST_COLUMN_IDENTIFIERS.amount,
    ]);
  });

  it("says what an unserved column waits on rather than showing a value nobody recorded", () => {
    for (const identifier of Object.keys(UNSERVED_COST_COLUMNS)) {
      expect(isUnservedColumn(identifier)).toBe(true);
      expect(unservedCellTitle(identifier)).toMatch(/^.+ is not served yet\. Waiting on .+\.$/);
      expect(columnById(identifier).text?.(cost())).toBe("");
    }
  });

  it("starts the unserved columns hidden and leaves the served ones showing", () => {
    expect(columnById(COST_COLUMN_IDENTIFIERS.entryNumber).hidden).toBe(true);
    expect(columnById(COST_COLUMN_IDENTIFIERS.dateEntered).hidden).toBe(true);
    expect(columnById(COST_COLUMN_IDENTIFIERS.enteredBy).hidden).toBe(true);
    expect(columnById(COST_COLUMN_IDENTIFIERS.payee).hidden).toBeUndefined();
    // Receipt stays visible: on a soft cost the column carries a true answer today.
    expect(columnById(COST_COLUMN_IDENTIFIERS.receipt).hidden).toBeUndefined();
  });

  it("reads an expense code off the record's own identifier, with the catalogue only for the label", () => {
    expect(expenseCodeFromIdentifier("utbmsCode_expense_E112")).toBe("E112");
    expect(expenseCodeFromIdentifier(null)).toBeNull();
    expect(expenseCodeText(cost(), noLabels)).toBe("E112");
    expect(expenseCodeText(cost(), () => "Court Fees")).toBe("E112 Court Fees");
    expect(expenseCodeText(cost({ utbmsExpenseCodeId: null }), noLabels)).toBe("");
  });

  it("does not claim a hard cost has no receipt when the listing never said", () => {
    expect(receiptText(cost({ disbursementClass: "soft" }))).toBe("—");
    expect(receiptText(cost({ disbursementClass: "hard" }))).toBe("Not served");
    expect(gapCellTitle("receipt")).toContain(COST_LEDGER_GAPS.receipt.waitsOn);
  });
});

describe("the payee, in its four honest states", () => {
  it("keeps a soft cost's absent payee apart from an unrecorded one", () => {
    expect(payeeState(cost({ disbursementClass: "soft", vendorId: null })).kind).toBe("soft");
    expect(payeeState(cost({ vendorId: null, vendorName: null })).kind).toBe("unrecorded");
    expect(payeeText(cost({ disbursementClass: "soft" }))).toBe("— (soft cost)");
    expect(payeeText(cost({ vendorId: null, vendorName: null }))).toBe("Not recorded");
  });

  it("says a recorded payee lost its directory entry rather than showing nothing", () => {
    const gone = cost({ vendorId: "directory_gone", vendorName: null });
    expect(payeeState(gone).kind).toBe("gone");
    expect(payeeText(gone)).toBe("No longer in the directory");
  });

  it("uses the name where there is one", () => {
    expect(payeeText(cost())).toBe("Eighth Judicial District Court Clerk");
  });
});

describe("the figures", () => {
  const ledger: readonly CostLedgerEntry[] = [
    cost({ id: "a", amountMinor: 10_000, status: "approved", billable: true }),
    cost({ id: "b", amountMinor: 20_000, status: "billed", billable: true }),
    cost({ id: "c", amountMinor: 5_000, status: "approved", billable: false }),
    cost({ id: "d", amountMinor: 99_000, status: "void", billable: true }),
    cost({
      id: "e",
      amountMinor: 2_500,
      status: "draft",
      billable: true,
      disbursementClass: "soft",
      vendorId: null,
      vendorName: null,
    }),
  ];

  it("never counts a void: a withdrawn cost was never advanced", () => {
    expect(countable(ledger).map((entry) => entry.id)).toEqual(["a", "b", "c", "e"]);
    expect(countsInTotals(cost({ status: "void" }))).toBe(false);
    const figures = footerFigures(ledger, { filtered: false });
    const advanced = figures.find((figure) => figure.identifier === "advanced");
    expect(advanced?.amountMinor).toBe(37_500);
  });

  it("splits the money the way a receivable actually behaves", () => {
    const figures = footerFigures(ledger, { filtered: false });
    expect(figures.map((figure) => figure.label)).toEqual([
      "advanced",
      "recoverable",
      "billed",
      "absorbed",
    ]);
    const by = (identifier: string) =>
      figures.find((figure) => figure.identifier === identifier)?.amountMinor;
    // Recoverable is what no invoice has taken up yet; billed is what one has.
    expect(by("recoverable")).toBe(12_500);
    expect(by("billed")).toBe(20_000);
    // Absorbing is a decision, so it is visible rather than folded into the total.
    expect(by("absorbed")).toBe(5_000);
  });

  it("says on the hover which scope a figure speaks for", () => {
    const whole = footerFigures(ledger, { filtered: false });
    const inView = footerFigures(ledger, { filtered: true });
    expect(whole[0]?.caption).not.toContain("in view");
    expect(inView[0]?.caption).toContain("in view");
  });

  it("summarises the matter in the cost's own vocabulary", () => {
    const summary = matterCostSummary(ledger);
    expect(summary.liveCount).toBe(4);
    expect(summary.voidCount).toBe(1);
    expect(summary.hardMinor).toBe(35_000);
    expect(summary.softMinor).toBe(2_500);
    expect(summary.absorbedMinor).toBe(5_000);
    // Only hard costs have a payee to rank, and the biggest leads.
    expect(summary.largestPayees[0]).toEqual({
      name: "Eighth Judicial District Court Clerk",
      amountMinor: 35_000,
    });
  });

  it("counts a selection honestly and says when it left a void out", () => {
    const mixed = selectionSummary([ledger[0]!, ledger[3]!], word);
    expect(mixed.count).toBe(2);
    expect(mixed.amountMinor).toBe(10_000);
    expect(mixed.excludesVoids).toBe(true);
    expect(mixed.statusLine).toBe("1 approved · 1 void");
    const clean = selectionSummary([ledger[0]!, ledger[1]!], word);
    expect(clean.excludesVoids).toBe(false);
    expect(clean.recoverableMinor).toBe(30_000);
  });

  it("counts what is waiting for review, which is what the Review control says", () => {
    expect(submittedCount(ledger)).toBe(0);
    expect(submittedCount([...ledger, cost({ id: "f", status: "submitted" })])).toBe(1);
  });

  it("takes the currency off the rows rather than assuming one", () => {
    expect(ledgerCurrency([])).toBe("USD");
    expect(ledgerCurrency([cost({ currency: "USD" })])).toBe("USD");
  });
});

describe("reading and refusing a draft", () => {
  it("takes an amount as a person types it, and refuses one that is not an amount", () => {
    expect(parseAmountMinor("270.00")).toBe(27_000);
    expect(parseAmountMinor("$1,842.50")).toBe(184_250);
    expect(parseAmountMinor("96")).toBe(9_600);
    expect(parseAmountMinor("")).toBeNull();
    expect(parseAmountMinor("0")).toBeNull();
    expect(parseAmountMinor("12.345")).toBeNull();
    expect(parseAmountMinor("later")).toBeNull();
  });

  it("names what is missing before the control is pressed, never after", () => {
    const base = {
      amountText: "270.00",
      description: "Complaint filing fee",
      disbursementClass: "hard" as const,
      vendorId: "directory_clerk" as string | null,
    };
    expect(costDraftRefusal(base)).toBeNull();
    expect(costDraftRefusal({ ...base, amountText: "" })).toBe("Enter the amount as spent");
    expect(costDraftRefusal({ ...base, description: "  " })).toContain("Info");
    // A hard cost IS cash paid to somebody, so it names who.
    expect(costDraftRefusal({ ...base, vendorId: null })).toContain("payee");
    // A soft cost has none by design, so it is never refused for lacking one.
    expect(costDraftRefusal({ ...base, disbursementClass: "soft", vendorId: null })).toBeNull();
  });
});

describe("the words", () => {
  it("keeps the recovery decision visible rather than folding it into a total", () => {
    expect(billingLabel(true)).toBe("Recoverable");
    expect(billingLabel(false)).toBe("Absorbed");
    expect(billingSentence(false)).toBe("Absorbed by the firm");
  });

  it("says how a cost came to be recorded, including the ones the platform captured itself", () => {
    expect(sourceLabel("manual")).toBe("Recorded by hand");
    expect(sourceLabel("grid")).toBe("The capture grid");
    expect(sourceLabel("recovery")).toBe("Auto-captured from Shipping");
  });

  it("completes every gap into the one sentence the Soon affordance says", () => {
    for (const name of Object.keys(COST_LEDGER_GAPS)) {
      const gap = name as keyof typeof COST_LEDGER_GAPS;
      expect(gapReason(gap)).toBe(COST_LEDGER_GAPS[gap].waitsOn);
      expect(gapCellTitle(gap)).toContain(COST_LEDGER_GAPS[gap].field);
    }
  });
});

function menuRecord(overrides: Partial<CostMenuRecord> = {}): CostMenuRecord {
  return {
    identifier: "costEntry_one",
    status: "draft",
    entryNumber: null,
    description: "Complaint filing fee",
    amount: "$270.00",
    disbursementClass: "hard",
    ...overrides,
  };
}

describe("the row menu", () => {
  it("keeps the shared ledger verbs rather than growing a second menu", () => {
    const target = menuRecord();
    const menu = costRecordMenu([target], target, { reviewGateEnabled: true });
    for (const identifier of ["open", "duplicate", "copyValue", "submit", "void"]) {
      expect(menuItem(menu, identifier)).not.toBeNull();
    }
  });

  it("adds the verbs a cost has and a time entry does not", () => {
    const target = menuRecord();
    const menu = costRecordMenu([target], target, { reviewGateEnabled: true });
    expect(menuItem(menu, "receipt")).not.toBeNull();
    expect(menuItem(menu, "print")).not.toBeNull();
  });

  it("refuses the receipt on a soft cost for its own reason, not for a missing dependency", () => {
    const soft = menuRecord({ disbursementClass: "soft" });
    const menu = costRecordMenu([soft], soft, { reviewGateEnabled: true });
    const receipt = menuItem(menu, "receipt");
    expect(receipt?.disabledReason).toContain("no vendor invoice");
    expect(receipt?.kind === "action" ? receipt.soonDependency : undefined).toBeUndefined();
  });

  it("shows the receipt verb on a hard cost as designed but not served", () => {
    const target = menuRecord();
    const menu = costRecordMenu([target], target, { reviewGateEnabled: true });
    const receipt = menuItem(menu, "receipt");
    expect(receipt?.kind === "action" ? receipt.soonDependency : undefined).toBe(
      gapReason("receiptPicker"),
    );
    expect(receipt === null ? true : isEnabled(receipt)).toBe(false);
  });

  it("offers Delete Draft only on a draft, and never instead of Void", () => {
    const draft = menuRecord();
    const draftMenu = costRecordMenu([draft], draft, { reviewGateEnabled: true });
    expect(menuItem(draftMenu, "deleteDraft")).not.toBeNull();
    expect(menuItem(draftMenu, "void")).not.toBeNull();

    const billed = menuRecord({ status: "billed" });
    const billedMenu = costRecordMenu([billed], billed, { reviewGateEnabled: true });
    // A cost that has been in review is voided, never deleted.
    expect(menuItem(billedMenu, "deleteDraft")).toBeNull();
  });

  it("draws no separator around a group that ended up empty", () => {
    const target = menuRecord({ status: "billed" });
    const menu = costRecordMenu([target], target, { reviewGateEnabled: false });
    for (const group of menu) expect(group.items.length).toBeGreaterThan(0);
  });
});
