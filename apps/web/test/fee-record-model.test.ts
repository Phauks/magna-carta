/*
 * The fee record's model: what a fee IS, what its columns are, and what a move between ledgers
 * carries.
 *
 * These are the places where a quiet mistake would be invisible on screen and wrong in a way a firm
 * would act on: an amount reached through a float, a footer figure counting a withdrawn charge, a
 * column set that reintroduced the struck invoice-line vocabulary, or a move that promised to carry
 * something it cannot.
 */
import { describe, expect, it } from "vitest";
import {
  FEE_COLUMN_IDENTIFIERS,
  FEE_LEDGER_INITIAL_SORT,
  feeLedgerColumns,
  isUnservedFeeColumn,
} from "../src/lib/billing/fee-columns.ts";
import {
  countsInTotals,
  feeDraftRefusal,
  feeMatterText,
  feePosition,
  isClaimable,
  parseAmountMinor,
  submittedCount,
  type FeeRecord,
} from "../src/lib/billing/fee-record.ts";
import { recorderText, returnedDraftReason } from "../src/lib/records/work-in-progress-record.ts";
import {
  LEDGER_RECORD_NAME,
  carryFacts,
  keptNumberNote,
  mayReclassify,
} from "../src/lib/records/reclassification.ts";

const money = (amountMinor: number): string => `$${(amountMinor / 100).toFixed(2)}`;

function makeFee(overrides: Partial<FeeRecord> = {}): FeeRecord {
  return {
    id: "fee_one",
    matterId: "matter_pemberton",
    serviceDate: "2026-08-22",
    timekeeperName: "Priya Raman",
    timekeeperUserId: "user_raman",
    description: "Site inspection attendance — flat charge",
    amountMinor: 40_000,
    currency: "USD",
    billable: true,
    status: "draft",
    kickBackReason: null,
    memo: null,
    invoiceId: null,
    createdAt: "2026-08-22T14:05:00.000Z",
    createdByUserId: "user_osei",
    createdByName: "Adaeze Osei",
    matterNumber: "2026-0114",
    matterTitle: "Pemberton Estate",
    ...overrides,
  };
}

describe("the fee ledger's columns", () => {
  const COLUMNS = feeLedgerColumns("USD");

  it("is exactly round seven's column set, in order", () => {
    expect(COLUMNS.map((column) => column.id)).toEqual([
      FEE_COLUMN_IDENTIFIERS.serviceDate,
      FEE_COLUMN_IDENTIFIERS.matter,
      FEE_COLUMN_IDENTIFIERS.entryNumber,
      FEE_COLUMN_IDENTIFIERS.dateEntered,
      FEE_COLUMN_IDENTIFIERS.enteredBy,
      FEE_COLUMN_IDENTIFIERS.returned,
      FEE_COLUMN_IDENTIFIERS.timekeeper,
      FEE_COLUMN_IDENTIFIERS.description,
      FEE_COLUMN_IDENTIFIERS.amount,
      FEE_COLUMN_IDENTIFIERS.billable,
      FEE_COLUMN_IDENTIFIERS.attachments,
      FEE_COLUMN_IDENTIFIERS.status,
    ]);
  });

  it("carries none of the invoice-line vocabulary a fee is not composed from", () => {
    // A fee is a recorded charge, not a projection of a bill. Nothing here names the document it
    // eventually rides, the kind of line it becomes, or the entries it was drawn from — there are
    // none.
    const labels = COLUMNS.map((column) => column.label);
    expect(labels).not.toContain("Invoice");
    expect(labels).not.toContain("Kind");
    expect(labels).not.toContain("Agreement");
    expect(labels).not.toContain("Drawn From");
    expect(labels).not.toContain("Info");
    expect(labels).toContain("Description");
  });

  it("anchors on the date the charge is for, newest first", () => {
    expect(FEE_LEDGER_INITIAL_SORT.columnId).toBe(FEE_COLUMN_IDENTIFIERS.serviceDate);
    expect(FEE_LEDGER_INITIAL_SORT.direction).toBe("descending");
    expect(COLUMNS[0]?.anchored).toBe(true);
  });

  it("names the status column Status, and reads its word out of the one register", () => {
    const status = COLUMNS.find((column) => column.id === FEE_COLUMN_IDENTIFIERS.status);
    expect(status?.label).toBe("Status");
    expect(status?.value(makeFee({ status: "submitted" }))).toBe("Submitted");
    expect(status?.value(makeFee({ status: "billed" }))).toBe("Billed");
  });

  it("hides the columns nothing can fill, and says so rather than showing a blank", () => {
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.entryNumber)).toBe(true);
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.attachments)).toBe(true);
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.description)).toBe(false);
    // The store serves these three now, so a cell that said "waiting on" would be the lie.
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.dateEntered)).toBe(false);
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.enteredBy)).toBe(false);
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.returned)).toBe(false);
  });

  it("reads the entered date, the recorder and a returned draft's reason off the record", () => {
    const column = (id: string) => COLUMNS.find((candidate) => candidate.id === id);
    expect(column(FEE_COLUMN_IDENTIFIERS.dateEntered)?.value(makeFee())).toBe(
      "2026-08-22T14:05:00.000Z",
    );
    expect(column(FEE_COLUMN_IDENTIFIERS.enteredBy)?.value(makeFee())).toBe("Adaeze Osei");
    // A recorded identifier with no name is a departed member, not an unrecorded one.
    expect(column(FEE_COLUMN_IDENTIFIERS.enteredBy)?.value(makeFee({ createdByName: null }))).toBe(
      "No longer at the firm",
    );
    expect(
      column(FEE_COLUMN_IDENTIFIERS.enteredBy)?.value(
        makeFee({ createdByUserId: null, createdByName: null }),
      ),
    ).toBe("Not recorded");
    expect(column(FEE_COLUMN_IDENTIFIERS.returned)?.value(makeFee())).toBeNull();
    expect(
      column(FEE_COLUMN_IDENTIFIERS.returned)?.value(
        makeFee({ kickBackReason: "This is the Harlow engagement." }),
      ),
    ).toBe("This is the Harlow engagement.");
  });

  it("renders the amount in major units at the boundary and nowhere before it", () => {
    const amount = COLUMNS.find((column) => column.id === FEE_COLUMN_IDENTIFIERS.amount);
    expect(amount?.value(makeFee({ amountMinor: 40_000 }))).toBe(400);
    expect(amount?.value(makeFee({ amountMinor: 125_050 }))).toBe(1250.5);
  });

  it("names the matter on a row that is not standing on one", () => {
    expect(feeMatterText(makeFee())).toBe("2026-0114 — Pemberton Estate");
    expect(feeMatterText(makeFee({ matterNumber: null }))).toBe("Pemberton Estate");
    expect(feeMatterText(makeFee({ matterNumber: null, matterTitle: null }))).toBe("Not resolved");
  });
});

describe("what a fee is", () => {
  it("takes an amount exactly as typed, and refuses nothing at all", () => {
    expect(parseAmountMinor("400")).toBe(40_000);
    expect(parseAmountMinor("$1,250.50")).toBe(125_050);
    expect(parseAmountMinor("0")).toBeNull();
    expect(parseAmountMinor("0.00")).toBeNull();
    expect(parseAmountMinor("twelve")).toBeNull();
    expect(parseAmountMinor("1.005")).toBeNull();
  });

  it("names what a draft is missing before anything is pressed", () => {
    expect(feeDraftRefusal({ amountText: "", description: "Something" })).toContain("amount");
    expect(feeDraftRefusal({ amountText: "400", description: "  " })).toContain("Description");
    expect(feeDraftRefusal({ amountText: "400", description: "Mediation package" })).toBeNull();
  });

  it("counts unbilled and billed over live billable fees only", () => {
    const fees = [
      makeFee({ id: "a", amountMinor: 40_000 }),
      makeFee({ id: "b", amountMinor: 85_000, status: "submitted" }),
      makeFee({ id: "c", amountMinor: 50_000, status: "billed", invoiceId: "invoice_381" }),
      // A withdrawn charge was never owed, and a non-billable one is never asked for.
      makeFee({ id: "d", amountMinor: 120_000, status: "void" }),
      makeFee({ id: "e", amountMinor: 9_900, billable: false }),
    ];
    expect(feePosition(fees)).toEqual({ unbilledMinor: 125_000, billedMinor: 50_000 });
    expect(submittedCount(fees)).toBe(1);
    expect(countsInTotals(makeFee({ status: "void" }))).toBe(false);
  });

  it("keeps what a bill cannot take up out of what it could claim", () => {
    expect(isClaimable(makeFee())).toBe(true);
    expect(isClaimable(makeFee({ billable: false }))).toBe(false);
    expect(isClaimable(makeFee({ status: "billed" }))).toBe(false);
    expect(isClaimable(makeFee({ status: "void" }))).toBe(false);
  });

  /*
   * The shared work-in-progress readings, over a FEE. They are asserted here as well as on the cost
   * ledger because the point of hoisting them was that both surfaces answer identically; a test on
   * one ledger alone would not have caught the second copy that made hoisting necessary.
   */
  it("reads a returned draft's reason as a DRAFT fact, whatever a stale row carries", () => {
    expect(returnedDraftReason(makeFee())).toBeNull();
    expect(returnedDraftReason(makeFee({ kickBackReason: "   " }))).toBeNull();
    expect(returnedDraftReason(makeFee({ kickBackReason: "Wrong matter." }))).toBe("Wrong matter.");
    // Approved with a reason still on the row: no surface may print "sent back because…" over it.
    expect(
      returnedDraftReason(makeFee({ status: "approved", kickBackReason: "Wrong matter." })),
    ).toBeNull();
  });

  it("tells a departed recorder from one nobody recorded", () => {
    expect(recorderText(makeFee())).toBe("Adaeze Osei");
    expect(recorderText(makeFee({ createdByName: null }))).toBe("No longer at the firm");
    expect(recorderText(makeFee({ createdByUserId: null, createdByName: null }))).toBe(
      "Not recorded",
    );
  });
});

describe("moving a charge between ledgers", () => {
  const draft = {
    kind: "fee" as const,
    status: "draft",
    invoiceNumber: null,
    claimedByDraftInvoice: false,
    mayWork: true,
    workersDescription: "the person who recorded it",
    amountMinor: 40_000,
  };

  it("moves a draft nothing is relying on, and refuses everything past that by name", () => {
    expect(mayReclassify(draft).allowed).toBe(true);
    expect(mayReclassify({ ...draft, status: "void" }).reason).toContain("frozen");
    expect(mayReclassify({ ...draft, invoiceNumber: "00381" }).reason).toContain("credit note");
    expect(mayReclassify({ ...draft, claimedByDraftInvoice: true }).reason).toContain(
      "Release the claim",
    );
    expect(mayReclassify({ ...draft, status: "approved" }).reason).toContain("Only a draft");
    expect(mayReclassify({ ...draft, mayWork: false }).reason).toContain(
      "the person who recorded it",
    );
  });

  it("states what carries FOR THE PAIR, because the differences are the whole decision", () => {
    const toTime = carryFacts("fee", "time", { amountMinor: 40_000 }, money);
    expect(toTime.keeps.join(" ")).toContain("held as the target amount");
    expect(toTime.loses.join(" ")).toContain("hours");
    expect(toTime.loses.join(" ")).toContain("incomplete");

    const toCost = carryFacts("fee", "cost", { amountMinor: 40_000 }, money);
    expect(toCost.keeps.join(" ")).toContain("carries exactly");
    expect(toCost.keeps.join(" ")).toContain("$400.00");
    expect(toCost.keeps.join(" ")).toContain("payee starts empty");

    const fromTime = carryFacts("time", "fee", { amountMinor: 40_000 }, money);
    expect(fromTime.keeps.join(" ")).toContain("becomes the fee's amount");
    expect(fromTime.loses.join(" ")).toContain("Hours and rate");
  });

  it("says the entry number is kept, wherever the pair lands", () => {
    expect(keptNumberNote("F-00014")).toContain("F-00014");
    expect(keptNumberNote(null)).toContain("kept");
    expect(LEDGER_RECORD_NAME.fee).toBe("Fee");
  });

  it("carries nothing where there was no amount, rather than promising a figure", () => {
    const facts = carryFacts("time", "fee", { amountMinor: null }, money);
    expect(facts.loses.join(" ")).toContain("No amount to carry");
    expect(facts.keeps.join(" ")).not.toContain("becomes the fee's amount");
  });
});
