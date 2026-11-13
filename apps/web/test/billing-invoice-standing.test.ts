/*
 * What a bill is, worked out rather than looked up.
 *
 * The cases pinned here are the ones where a wrong answer is invisible on screen and acted on: a
 * draft reading as though it owed something, a voided draft counting toward a total, an overdue day
 * count that is a stored flag rather than arithmetic, and a matter reading another matter's share of
 * a bill that charges both.
 */
import { describe, expect, it } from "vitest";
import type {
  CreditNote,
  InvoiceDetail,
  InvoiceLine,
  InvoiceListItem,
} from "../src/lib/billing/billing-api.ts";
import {
  billStage,
  billUnpaidMinor,
  civilDatePlusDays,
  creditedMinor,
  deliveryReading,
  draftTotalMinor,
  invoiceReference,
  invoiceStanding,
  matterShareMinor,
  matterUnpaidMinor,
  overdueDays,
  type InvoiceRow,
} from "../src/lib/billing/invoice-standing.ts";

const THIS_MATTER = "matter_pemberton";
const OTHER_MATTER = "matter_escrow";

function line(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: "invoiceLine_one",
    lineIndex: 0,
    matterId: THIS_MATTER,
    matterNumber: null,
    matterTitle: null,
    kind: "fee",
    description: "Professional services",
    amountMinor: 100_000,
    ...overrides,
  };
}

function summary(overrides: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return {
    id: "invoice_one",
    clientEntityId: "entity_pemberton",
    clientName: "Pemberton Holdings",
    currency: "USD",
    status: "final",
    invoiceNumber: "00413",
    issueDate: "2026-08-05",
    dueDate: "2026-09-04",
    totalMinor: 100_000,
    appliedMinor: 0,
    unpaidMinor: 100_000,
    createdAt: "2026-08-05T09:30:00.000Z",
    ...overrides,
  };
}

function detail(base: InvoiceListItem, overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    ...base,
    delivery: {
      delivered: false,
      deliveredOn: null,
      attemptCount: 0,
      failedAttemptCount: 0,
      lastAttemptOn: null,
    },
    lines: [line()],
    matterBalances: [
      {
        matterId: THIS_MATTER,
        matterNumber: null,
        matterTitle: null,
        totalMinor: 100_000,
        appliedMinor: 0,
        unpaidMinor: 100_000,
      },
    ],
    ...overrides,
  };
}

function row(
  overrides: Partial<InvoiceListItem> = {},
  detailOverrides?: Partial<InvoiceDetail>,
): InvoiceRow {
  const base = summary(overrides);
  return { summary: base, detail: detail(base, detailOverrides), creditNotes: [] };
}

describe("a bill's standing", () => {
  it("is the invoice's own word for a draft and a void", () => {
    expect(invoiceStanding(row({ status: "draft", invoiceNumber: null }))).toBe("draft");
    expect(invoiceStanding(row({ status: "void", invoiceNumber: null }))).toBe("void");
  });

  it("is arithmetic over what has been applied for a finalized bill", () => {
    expect(invoiceStanding(row({ appliedMinor: 0 }))).toBe("unpaid");
    expect(invoiceStanding(row({ appliedMinor: 40_000 }))).toBe("partially-paid");
    expect(invoiceStanding(row({ appliedMinor: 100_000 }))).toBe("paid");
  });

  it("reaches the paid stage only when the whole bill is settled", () => {
    expect(billStage(row({ status: "draft" }))).toBe("draft");
    expect(billStage(row({ appliedMinor: 40_000 }))).toBe("finalized");
    expect(billStage(row({ appliedMinor: 100_000 }))).toBe("paid");
  });
});

describe("this matter's share of a bill", () => {
  it("comes from the draft's own lines, because a draft has no stored total", () => {
    const draft = row(
      { status: "draft", invoiceNumber: null, totalMinor: 0, appliedMinor: 0 },
      {
        lines: [
          line({ id: "l1", amountMinor: 60_000 }),
          line({ id: "l2", amountMinor: 25_000 }),
          line({ id: "l3", matterId: OTHER_MATTER, amountMinor: 90_000 }),
        ],
        matterBalances: [],
      },
    );
    expect(matterShareMinor(draft, THIS_MATTER)).toBe(85_000);
    expect(draftTotalMinor(draft.detail)).toBe(175_000);
  });

  it("comes from the per-matter balance once the bill is finalized", () => {
    const shared = row(
      { totalMinor: 300_000, appliedMinor: 50_000 },
      {
        matterBalances: [
          {
            matterId: THIS_MATTER,
            matterNumber: null,
            matterTitle: null,
            totalMinor: 200_000,
            appliedMinor: 50_000,
            unpaidMinor: 150_000,
          },
          {
            matterId: OTHER_MATTER,
            matterNumber: null,
            matterTitle: null,
            totalMinor: 100_000,
            appliedMinor: 0,
            unpaidMinor: 100_000,
          },
        ],
      },
    );
    expect(matterShareMinor(shared, THIS_MATTER)).toBe(200_000);
    expect(matterUnpaidMinor(shared, THIS_MATTER)).toBe(150_000);
    // The whole bill still owes more than this matter does, and the two are different figures.
    expect(billUnpaidMinor(shared)).toBe(250_000);
  });

  it("is absent, not zero, where the question does not arise", () => {
    // A zero would read as "settled". A draft owes nothing YET; a voided draft never owed anything.
    expect(matterUnpaidMinor(row({ status: "draft" }), THIS_MATTER)).toBeNull();
    expect(matterUnpaidMinor(row({ status: "void" }), THIS_MATTER)).toBeNull();
    expect(matterShareMinor(row({ status: "void" }), THIS_MATTER)).toBeNull();
  });
});

describe("overdue", () => {
  it("is worked out from the date, so a settled bill is never late", () => {
    expect(overdueDays(row({ dueDate: "2026-09-04" }), "2026-09-20")).toBe(16);
    expect(overdueDays(row({ dueDate: "2026-09-04", appliedMinor: 100_000 }), "2026-09-20")).toBe(
      0,
    );
  });

  it("is zero before the due date and on it", () => {
    expect(overdueDays(row({ dueDate: "2026-09-04" }), "2026-09-04")).toBe(0);
    expect(overdueDays(row({ dueDate: "2026-09-04" }), "2026-08-30")).toBe(0);
  });

  it("does not arise on a draft or a voided draft", () => {
    expect(overdueDays(row({ status: "draft", dueDate: null }), "2026-12-01")).toBe(0);
    expect(overdueDays(row({ status: "void", dueDate: null }), "2026-12-01")).toBe(0);
  });
});

/** Dates arrive already rendered by the surface, so the tests read them back unchanged. */
const readDate = (isoDate: string): string => isoDate;

/** One credit note standing beside a bill. */
function creditNote(id: string, totalMinor: number): CreditNote {
  return {
    id,
    reason: "Charged in error",
    effectiveDate: "2026-08-08",
    currency: "USD",
    issuedAt: "2026-08-08T10:41:00.000Z",
    totalMinor,
    lines: [],
  };
}

describe("what the delivered column says", () => {
  it("names the FIRST success, so a courtesy re-send does not move the date", () => {
    const delivered = row(
      {},
      {
        delivery: {
          delivered: true,
          deliveredOn: "2026-08-06",
          attemptCount: 3,
          failedAttemptCount: 1,
          lastAttemptOn: "2026-08-20",
        },
      },
    );
    const reading = deliveryReading(delivered, readDate);
    expect(reading.key).toBe("delivered");
    expect(reading.text).toBe("2026-08-06");
    expect(reading.title).toContain("3 attempts");
  });

  it("tells a bill that has never been sent apart from one that has been chased", () => {
    const chased = row(
      {},
      {
        delivery: {
          delivered: false,
          deliveredOn: null,
          attemptCount: 2,
          failedAttemptCount: 2,
          lastAttemptOn: "2026-08-20",
        },
      },
    );
    expect(deliveryReading(chased, readDate).key).toBe("failed");
    expect(deliveryReading(row(), readDate).key).toBe("none");
    expect(deliveryReading(row(), readDate).text).toBe("None recorded");
  });

  it("says only a finalized bill can be delivered", () => {
    const draft = row({ status: "draft", invoiceNumber: null });
    expect(deliveryReading(draft, readDate).title).toContain("finalized bill");
  });
});

describe("what a bill is called where it has no number", () => {
  it("tells a draft apart from a draft that was thrown away", () => {
    expect(invoiceReference(row({ status: "draft", invoiceNumber: null }))).toBe("Draft");
    expect(invoiceReference(row({ status: "void", invoiceNumber: null }))).toBe("Draft (voided)");
    expect(invoiceReference(row())).toBe("00413");
  });
});

describe("credited", () => {
  it("sums the credit notes standing beside the bill", () => {
    const corrected: InvoiceRow = {
      ...row(),
      creditNotes: [creditNote("cn1", 12_000), creditNote("cn2", 6000)],
    };
    expect(creditedMinor(corrected)).toBe(18_000);
    expect(creditedMinor(row())).toBe(0);
  });
});

describe("a civil date stepped by whole days", () => {
  it("steps in UTC, so a due date does not land a day early", () => {
    expect(civilDatePlusDays("2026-08-27", 30)).toBe("2026-09-26");
    expect(civilDatePlusDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(civilDatePlusDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
