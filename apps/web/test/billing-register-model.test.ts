/*
 * The register's column model, its footer figures, and the verbs it offers.
 *
 * These are the places on this surface where a quiet mistake would be invisible on screen and wrong
 * in a way a firm would act on: a column that summed the whole bill under a heading that says this
 * matter, a footer figure that changed scope without saying so, a verb offered on a bill that cannot
 * take it, and a capability that vanished instead of saying what it waits on.
 */
import { describe, expect, it } from "vitest";
import type { InvoiceDetail, InvoiceListItem } from "../src/lib/billing/billing-api.ts";
import type { InvoiceRow } from "../src/lib/billing/invoice-standing.ts";
import {
  BILL_COLUMN_IDENTIFIERS,
  BILL_REGISTER_INITIAL_SORT,
  absentShareTitle,
  billColumns,
} from "../src/lib/billing/bill-columns.ts";
import { billCounts, billFigures } from "../src/lib/billing/bill-figures.ts";
import { BILL_DEPENDENCIES, billActions, billRecordMenu } from "../src/lib/billing/bill-actions.ts";
// The pure model module, not the catalogue's index: the index also exports the rendering component.
import { isEnabled, menuItem } from "../src/lib/records/record-menu-model.ts";

const THIS_MATTER = "matter_pemberton";
const OTHER_MATTER = "matter_escrow";

const COLUMNS = billColumns({
  matterId: THIS_MATTER,
  clientName: "Eleanor Pemberton",
  currency: "USD",
});

function makeRow(summary: Partial<InvoiceListItem>, detail?: Partial<InvoiceDetail>): InvoiceRow {
  const base: InvoiceListItem = {
    id: summary.id ?? "invoice_one",
    clientEntityId: "entity_pemberton",
    currency: "USD",
    status: "final",
    invoiceNumber: "00413",
    issueDate: "2026-08-05",
    dueDate: "2026-09-04",
    totalMinor: 100_000,
    appliedMinor: 0,
    unpaidMinor: 100_000,
    createdAt: "2026-08-05T09:30:00.000Z",
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
      lines: [
        {
          id: "invoiceLine_one",
          lineIndex: 0,
          matterId: THIS_MATTER,
          kind: "fee",
          description: "Professional services",
          amountMinor: base.totalMinor,
        },
      ],
      matterBalances: [
        {
          matterId: THIS_MATTER,
          totalMinor: base.totalMinor,
          appliedMinor: base.appliedMinor,
          unpaidMinor: base.totalMinor - base.appliedMinor,
        },
      ],
      ...detail,
    },
    creditNotes: [],
  };
}

function column(id: string) {
  const found = COLUMNS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`The register has no ${id} column.`);
  return found;
}

describe("the register's columns", () => {
  it("anchors the row on the invoice, which is what a bill is called out loud", () => {
    const [first] = COLUMNS;
    expect(first?.id).toBe(BILL_COLUMN_IDENTIFIERS.invoiceNumber);
    expect(first?.anchored).toBe(true);
  });

  it("opens on what was raised most recently", () => {
    expect(BILL_REGISTER_INITIAL_SORT.columnId).toBe(BILL_COLUMN_IDENTIFIERS.createdAt);
    expect(BILL_REGISTER_INITIAL_SORT.direction).toBe("descending");
  });

  it("leads with THIS MATTER'S share and keeps the whole bill beside it, hidden", () => {
    const share = column(BILL_COLUMN_IDENTIFIERS.matterShare);
    const whole = column(BILL_COLUMN_IDENTIFIERS.billTotal);
    expect(share.label).toBe("This Matter");
    expect(share.hidden).toBeUndefined();
    expect(whole.label).toBe("Total (all matters)");
    expect(whole.hidden).toBe(true);

    const shared = makeRow(
      { totalMinor: 300_000 },
      {
        matterBalances: [
          {
            matterId: THIS_MATTER,
            totalMinor: 200_000,
            appliedMinor: 0,
            unpaidMinor: 200_000,
          },
          { matterId: OTHER_MATTER, totalMinor: 100_000, appliedMinor: 0, unpaidMinor: 100_000 },
        ],
      },
    );
    // The share column speaks for the matter; the total column speaks for the document. A register
    // that summed the document under this heading would misstate the matter by the other matter.
    expect(share.value(shared)).toBe(2000);
    expect(whole.value(shared)).toBe(3000);
  });

  it("sums exactly the four money columns and nothing else", () => {
    const summed = COLUMNS.filter((candidate) => candidate.total === "sum").map(
      (candidate) => candidate.id,
    );
    expect(summed).toEqual([
      BILL_COLUMN_IDENTIFIERS.matterShare,
      BILL_COLUMN_IDENTIFIERS.matterUnpaid,
      BILL_COLUMN_IDENTIFIERS.billTotal,
      BILL_COLUMN_IDENTIFIERS.credited,
    ]);
  });

  it("leaves an absent figure absent rather than reading it as a zero", () => {
    // The grid sorts an empty value last and the surface renders it as a dash; a zero would read as
    // "settled" on a bill that never charged anybody anything.
    const voided = makeRow({ status: "void", invoiceNumber: null });
    expect(column(BILL_COLUMN_IDENTIFIERS.matterShare).value(voided)).toBeNull();
    expect(column(BILL_COLUMN_IDENTIFIERS.matterUnpaid).value(voided)).toBeNull();
    expect(absentShareTitle(voided)).toContain("never owed");
  });

  it("filters Delivered on the question a firm asks, not on one date per bill", () => {
    const delivered = column(BILL_COLUMN_IDENTIFIERS.delivered);
    expect(delivered.filter).toBe("set");
    expect(delivered.value(makeRow({}))).toBe("None recorded");
    expect(delivered.value(makeRow({ status: "draft", invoiceNumber: null }))).toBe(
      "Not deliverable yet",
    );
    const reached = makeRow(
      {},
      {
        delivery: {
          delivered: true,
          deliveredOn: "2026-08-06",
          attemptCount: 1,
          failedAttemptCount: 0,
          lastAttemptOn: "2026-08-06",
        },
      },
    );
    expect(delivered.value(reached)).toBe("Delivered");
  });
});

/** How an amount reads, so a caption can quote one. The surface owns the real formatting. */
const money = (minor: number): string => `$${(minor / 100).toFixed(2)}`;

describe("the register's footer figures", () => {
  const unbilled = {
    matterId: THIS_MATTER,
    timeEntryCount: 5,
    timeAmountMinor: 250_000,
    costEntryCount: 2,
    costAmountMinor: 8000,
    receivableTotalMinor: 0,
    receivableAppliedMinor: 0,
    receivableUnpaidMinor: 0,
  };

  const rows = [
    // A draft has no stored total and no balances: its figure is the sum of the lines it holds.
    makeRow(
      { id: "d1", status: "draft", invoiceNumber: null, totalMinor: 0, appliedMinor: 0 },
      {
        matterBalances: [],
        lines: [
          {
            id: "dl1",
            lineIndex: 0,
            matterId: THIS_MATTER,
            kind: "fee",
            description: "Deposition preparation",
            amountMinor: 85_000,
          },
        ],
      },
    ),
    makeRow({ id: "i1", totalMinor: 100_000, appliedMinor: 40_000 }),
    makeRow({ id: "v1", status: "void", invoiceNumber: null }),
  ];

  it("states unbilled, on drafts and outstanding, in that order", () => {
    const figures = billFigures(rows, { unbilled, filtered: false, money });
    expect(figures.map((figure) => figure.identifier)).toEqual([
      "unbilled",
      "onDrafts",
      "outstanding",
    ]);
    expect(figures[0]?.amountMinor).toBe(258_000);
    // The draft's figure is the sum of its lines, which is the only total a draft has.
    expect(figures[1]?.amountMinor).toBe(85_000);
    // Outstanding counts finalized bills only: a voided draft never owed anything.
    expect(figures[2]?.amountMinor).toBe(60_000);
  });

  it("drops the unbilled figure under a filter rather than restating it out of scope", () => {
    // It counts time and costs, not invoices, so no filter over invoices could narrow it.
    const figures = billFigures(rows, { unbilled, filtered: true, money });
    expect(figures.map((figure) => figure.identifier)).toEqual(["onDrafts", "outstanding"]);
    expect(figures.every((figure) => figure.caption.includes("in view"))).toBe(true);
  });

  it("counts the three kinds of bill separately", () => {
    expect(billCounts(rows)).toEqual({ finalized: 1, drafts: 1, voided: 1 });
  });
});

describe("the verbs a bill offers", () => {
  const context = {
    matterId: THIS_MATTER,
    permissions: null,
    openClientCreditMinor: null,
    money,
  };

  it("offers a draft the two verbs a draft can take, and no others", () => {
    const draft = makeRow({ status: "draft", invoiceNumber: null });
    const identifiers = billActions(draft, context).map((action) => action.identifier);
    expect(identifiers).toContain("finalize");
    expect(identifiers).toContain("voidDraft");
    expect(identifiers).not.toContain("creditNote");
    expect(identifiers).not.toContain("recordDelivery");
  });

  it("never offers to void a finalized bill: it is corrected beside itself", () => {
    const identifiers = billActions(makeRow({}), context).map((action) => action.identifier);
    expect(identifiers).not.toContain("voidDraft");
    expect(identifiers).toContain("creditNote");
  });

  it("keeps a not-yet-built capability on screen with what it waits on", () => {
    const payment = billActions(makeRow({}), context).find(
      (action) => action.identifier === "recordPayment",
    );
    expect(payment?.soonDependency).toBe(BILL_DEPENDENCIES.payment);
    expect(payment === undefined ? true : isEnabled(payment)).toBe(false);
  });

  it("refuses applying anything to a settled bill, and says why rather than hiding the verb", () => {
    const settled = makeRow({ appliedMinor: 100_000 });
    const applyTrust = billActions(settled, context).find(
      (action) => action.identifier === "applyTrust",
    );
    expect(applyTrust?.disabledReason).toContain("settled");
  });

  it("names the capability an account is missing, so an administrator knows what to grant", () => {
    const withoutCredit = billActions(makeRow({}), {
      ...context,
      permissions: ["billing:read", "billing:draft"],
    });
    const creditNote = withoutCredit.find((action) => action.identifier === "creditNote");
    expect(creditNote?.disabledReason).toContain("billing:credit");
  });

  it("offers the client credit only where the client is carrying one", () => {
    const without = billActions(makeRow({}), context).map((action) => action.identifier);
    expect(without).not.toContain("applyClientCredit");
    const withCredit = billActions(makeRow({}), {
      ...context,
      openClientCreditMinor: 120_000,
    }).map((action) => action.identifier);
    expect(withCredit).toContain("applyClientCredit");
  });

  it("groups the row menu so no separator ever bounds nothing", () => {
    const menu = billRecordMenu(makeRow({ status: "draft", invoiceNumber: null }), context);
    expect(menu.every((group) => group.items.length > 0)).toBe(true);
    expect(menuItem(menu, "open")).not.toBeNull();
    // A draft has drawn no number, so nothing offers to copy one.
    expect(menuItem(menu, "copyNumber")).toBeNull();
  });
});
