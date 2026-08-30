/*
 * The fee ledger's projection, and the agreement's own words.
 *
 * A fee has no work-in-progress store: every row of the charge ledger is a line on one of the
 * matter's bills, or a line of a credit note recorded beside one. So the mistakes worth pinning are
 * projection mistakes — a cost line appearing among the fees, a credit reading positive, another
 * matter's charges counted against this one, and a charge claiming an agreement version that was not
 * in force when the bill was issued.
 */
import { describe, expect, it } from "vitest";
import type {
  ArrangementVersion,
  CreditNote,
  InvoiceDetail,
  InvoiceListItem,
} from "../src/lib/billing/billing-api.ts";
import type { InvoiceRow } from "../src/lib/billing/invoice-standing.ts";
import { arrangementInForceOn, feeCharges, feePosition } from "../src/lib/billing/fee-charges.ts";
import {
  ARRANGEMENT_KIND_LABELS,
  arrangementTerms,
  takesAdvanceDeposit,
  versionPeriod,
} from "../src/lib/billing/fee-agreement.ts";
import {
  FEE_COLUMN_IDENTIFIERS,
  FEE_LEDGER_INITIAL_SORT,
  feeLedgerColumns,
  isUnservedFeeColumn,
} from "../src/lib/billing/fee-columns.ts";

const THIS_MATTER = "matter_pemberton";
const OTHER_MATTER = "matter_escrow";

function version(overrides: Partial<ArrangementVersion> = {}): ArrangementVersion {
  return {
    id: "billingArrangement_one",
    matterId: THIS_MATTER,
    version: 1,
    kind: "hourly",
    flatFeeAmountMinor: null,
    contingencyShareE4: null,
    contingencyBasis: null,
    retainerTargetMinor: null,
    retainerThresholdMinor: null,
    advanceDepositDestination: null,
    currency: "USD",
    validFrom: "2026-06-29",
    validTo: null,
    ...overrides,
  };
}

function bill(
  summary: Partial<InvoiceListItem>,
  lines: InvoiceDetail["lines"],
  creditNotes: readonly CreditNote[] = [],
): InvoiceRow {
  const base: InvoiceListItem = {
    id: summary.id ?? "invoice_one",
    clientEntityId: "entity_pemberton",
    currency: "USD",
    status: "final",
    invoiceNumber: "00097",
    issueDate: "2026-08-05",
    dueDate: "2026-09-04",
    totalMinor: 500_000,
    appliedMinor: 0,
    unpaidMinor: 500_000,
    createdAt: "2026-08-04T11:05:00.000Z",
    ...summary,
  };
  return {
    summary: base,
    detail: {
      ...base,
      delivery: {
        delivered: false,
        deliveredOn: null,
        attemptCount: 0,
        failedAttemptCount: 0,
        lastAttemptOn: null,
      },
      lines,
      matterBalances: [
        {
          matterId: THIS_MATTER,
          totalMinor: base.totalMinor,
          appliedMinor: base.appliedMinor,
          unpaidMinor: base.totalMinor - base.appliedMinor,
        },
      ],
    },
    creditNotes,
  };
}

describe("the charge ledger's projection", () => {
  const rows = [
    bill({ id: "invoice_097", invoiceNumber: "00097", issueDate: "2026-08-05" }, [
      {
        id: "l1",
        lineIndex: 0,
        matterId: THIS_MATTER,
        kind: "fee",
        description: "Professional services, July",
        amountMinor: 537_450,
      },
      {
        id: "l2",
        lineIndex: 1,
        matterId: THIS_MATTER,
        kind: "discount",
        description: "Courtesy discount",
        amountMinor: -13_750,
      },
      {
        id: "l3",
        lineIndex: 2,
        matterId: THIS_MATTER,
        kind: "cost",
        description: "Court reporter",
        amountMinor: 48_500,
      },
      {
        id: "l4",
        lineIndex: 3,
        matterId: OTHER_MATTER,
        kind: "fee",
        description: "Escrow dispute",
        amountMinor: 165_000,
      },
    ]),
    bill(
      { id: "invoice_081", invoiceNumber: "00081", issueDate: "2026-07-15", appliedMinor: 500_000 },
      [
        {
          id: "l5",
          lineIndex: 0,
          matterId: THIS_MATTER,
          kind: "fee",
          description: "Professional services, June",
          amountMinor: 247_000,
        },
      ],
      [
        {
          id: "creditNote_004",
          reason: "Billed at the partner rate in error",
          effectiveDate: "2026-08-08",
          currency: "USD",
          issuedAt: "2026-08-08T10:41:00.000Z",
          totalMinor: 18_000,
          lines: [
            {
              id: "cnl1",
              matterId: THIS_MATTER,
              kind: "fee",
              description: "Rate difference on the July 5 conference",
              amountMinor: 18_000,
              creditsInvoiceLineId: "l5",
            },
          ],
        },
      ],
    ),
  ];

  const charges = feeCharges(rows, THIS_MATTER, [version()]);

  it("leaves cost lines out: costs are not fees, and the two meet only on the invoice", () => {
    expect(charges.some((charge) => charge.narrative === "Court reporter")).toBe(false);
  });

  it("leaves another matter's charges out", () => {
    expect(charges.some((charge) => charge.narrative === "Escrow dispute")).toBe(false);
  });

  it("states a credit note's direction, because the contract carries a magnitude", () => {
    const credit = charges.find((charge) => charge.kind === "credit");
    expect(credit?.amountMinor).toBe(-18_000);
    expect(credit?.standing).toBe("credited");
  });

  it("reads a charge's standing off the bill it rides", () => {
    const unpaid = charges.find((charge) => charge.document === "00097" && charge.kind === "fee");
    const paid = charges.find((charge) => charge.document === "00081" && charge.kind === "fee");
    expect(unpaid?.standing).toBe("finalized");
    expect(paid?.standing).toBe("paid");
  });

  it("names where on the document each charge sits", () => {
    const discount = charges.find((charge) => charge.kind === "discount");
    expect(discount?.reference).toBe("00097 · L2");
  });

  it("sorts newest first", () => {
    expect(charges.map((charge) => charge.date)).toEqual(
      charges
        .map((c) => c.date)
        .toSorted()
        .toReversed(),
    );
  });

  it("counts billed and collected the way the books do", () => {
    const position = feePosition(charges, 812_600);
    // Billed is every charge that is not a credit: a discount is a line on the bill.
    expect(position.billedMinor).toBe(537_450 - 13_750 + 247_000);
    // Collected is the paid bill's charges, net of the credit handed back.
    expect(position.collectedMinor).toBe(247_000 - 18_000);
    expect(position.unbilledMinor).toBe(812_600);
  });
});

describe("the agreement version a charge was composed under", () => {
  const history = [
    version({
      id: "v1",
      version: 1,
      kind: "hourly",
      validFrom: "2026-01-01",
      validTo: "2026-07-01",
    }),
    version({
      id: "v2",
      version: 2,
      kind: "flat_fee",
      flatFeeAmountMinor: 750_000,
      advanceDepositDestination: "trust",
      validFrom: "2026-07-01",
      validTo: null,
    }),
  ];

  it("is the version in force on the day, not simply the latest one", () => {
    expect(arrangementInForceOn(history, "2026-03-15")?.version).toBe(1);
    expect(arrangementInForceOn(history, "2026-08-05")?.version).toBe(2);
    // The boundary belongs to the version that took effect on it.
    expect(arrangementInForceOn(history, "2026-07-01")?.version).toBe(2);
  });

  it("rides only an arrangement-composed line", () => {
    const rows = [
      bill({ id: "invoice_a", issueDate: "2026-08-05" }, [
        {
          id: "hourly-line",
          lineIndex: 0,
          matterId: THIS_MATTER,
          kind: "fee",
          description: "Professional services",
          amountMinor: 100_000,
        },
        {
          id: "flat-line",
          lineIndex: 1,
          matterId: THIS_MATTER,
          kind: "flat_fee",
          description: "Expert report package",
          amountMinor: 250_000,
        },
      ]),
    ];
    const charges = feeCharges(rows, THIS_MATTER, history);
    expect(charges.find((charge) => charge.kind === "fee")?.arrangementLabel).toBeNull();
    expect(charges.find((charge) => charge.kind === "flat_fee")?.arrangementLabel).toBe(
      "v2 Flat Fee",
    );
  });
});

/** How an amount reads. The surface owns the real formatting; the terms only quote it. */
const money = (minor: number): string => `$${(minor / 100).toFixed(2)}`;

describe("the agreement in words", () => {
  it("says a matter with no recorded agreement is billed hourly", () => {
    expect(arrangementTerms(null, money)).toContain("hourly");
  });

  it("states a flat fee's amount and where its advance deposit sits", () => {
    const terms = arrangementTerms(
      version({
        kind: "flat_fee",
        flatFeeAmountMinor: 750_000,
        advanceDepositDestination: "trust",
      }),
      money,
    );
    expect(terms).toContain("$7500.00");
    expect(terms).toContain("trust");
  });

  it("states the contingency costs election, which is the term the client signs", () => {
    const grossFirst = arrangementTerms(
      version({
        kind: "contingency",
        contingencyShareE4: 3333,
        contingencyBasis: "gross_recovery",
      }),
      money,
    );
    expect(grossFirst).toContain("33.33%");
    expect(grossFirst).toContain("after the fee");

    const netFirst = arrangementTerms(
      version({
        kind: "contingency",
        contingencyShareE4: 4000,
        contingencyBasis: "net_after_costs",
      }),
      money,
    );
    expect(netFirst).toContain("before the fee");
  });

  it("says out loud when the deposit destination was never recorded", () => {
    const terms = arrangementTerms(
      version({ kind: "flat_fee", flatFeeAmountMinor: 500_000, advanceDepositDestination: null }),
      money,
    );
    expect(terms).toContain("nobody recorded");
  });

  it("knows which kinds take an advance deposit at all", () => {
    expect(takesAdvanceDeposit("flat_fee")).toBe(true);
    expect(takesAdvanceDeposit("retainer")).toBe(true);
    expect(takesAdvanceDeposit("hourly")).toBe(false);
    expect(takesAdvanceDeposit("contingency")).toBe(false);
  });

  it("names the version in force as running to now", () => {
    expect(versionPeriod(version(), (isoDate) => isoDate)).toBe("2026-06-29 to now");
    expect(versionPeriod(version({ validTo: "2026-07-01" }), (isoDate) => isoDate)).toBe(
      "2026-06-29 to 2026-07-01",
    );
  });

  it("names every kind, so a chip never renders a wire word", () => {
    expect(Object.values(ARRANGEMENT_KIND_LABELS)).toEqual([
      "Hourly",
      "Flat Fee",
      "Contingency",
      "Evergreen Retainer",
    ]);
  });
});

describe("the fee ledger's columns", () => {
  const columns = feeLedgerColumns("USD");

  it("anchors on the date, which is the document's date", () => {
    const [first] = columns;
    expect(first?.id).toBe(FEE_COLUMN_IDENTIFIERS.date);
    expect(first?.anchored).toBe(true);
    expect(FEE_LEDGER_INITIAL_SORT.direction).toBe("descending");
  });

  it("sums the signed amount and nothing else", () => {
    const summed = columns.filter((column) => column.total === "sum").map((column) => column.id);
    expect(summed).toEqual([FEE_COLUMN_IDENTIFIERS.amount]);
  });

  it("keeps the column the read cannot fill, hidden and marked", () => {
    const drawn = columns.find((column) => column.id === FEE_COLUMN_IDENTIFIERS.drawnFrom);
    expect(drawn?.hidden).toBe(true);
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.drawnFrom)).toBe(true);
    expect(isUnservedFeeColumn(FEE_COLUMN_IDENTIFIERS.amount)).toBe(false);
  });
});
