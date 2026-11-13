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
import type { MatterPartyEntry } from "../src/lib/matters/party-api.ts";
import {
  BILL_COLUMN_IDENTIFIERS,
  BILL_REGISTER_INITIAL_SORT,
  absentShareTitle,
  billColumns,
  invoiceStatusesForStandings,
  standingFilterForStatuses,
} from "../src/lib/billing/bill-columns.ts";
import { clientPartyOf } from "../src/lib/billing/client-party.ts";
import { billCounts, billFigures } from "../src/lib/billing/bill-figures.ts";
import {
  BILL_DEPENDENCIES,
  billAction,
  billActions,
  billRecordMenu,
  invoiceBarActions,
  invoiceMoneyActions,
  isAdjustable,
} from "../src/lib/billing/bill-actions.ts";
// The pure model module, not the catalogue's index: the index also exports the rendering component.
import { isEnabled, menuItem } from "../src/lib/records/record-menu-model.ts";

const THIS_MATTER = "matter_pemberton";
const OTHER_MATTER = "matter_escrow";

const COLUMNS = billColumns({
  scope: { kind: "matter", matterId: THIS_MATTER, clientName: "Eleanor Pemberton" },
  currency: "USD",
});

/** The same declaration from the firm's own register, where no matter stands behind the rows. */
const FIRM_COLUMNS = billColumns({ scope: { kind: "firm" }, currency: "USD" });

function makeRow(summary: Partial<InvoiceListItem>, detail?: Partial<InvoiceDetail>): InvoiceRow {
  const base: InvoiceListItem = {
    id: summary.id ?? "invoice_one",
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
          matterNumber: null,
          matterTitle: null,
          kind: "fee",
          description: "Professional services",
          amountMinor: base.totalMinor,
        },
      ],
      matterBalances: [
        {
          matterId: THIS_MATTER,
          matterNumber: null,
          matterTitle: null,
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
    expect(first?.id).toBe(BILL_COLUMN_IDENTIFIERS.createdAt);
    expect(first?.anchored).toBe(true);
    // The number follows immediately, where it is read — but it cannot anchor, because two of the
    // three states have no number at all and an anchor that goes empty leaves the eye with nothing.
    expect(COLUMNS[1]?.id).toBe(BILL_COLUMN_IDENTIFIERS.invoiceNumber);
    expect(COLUMNS[1]?.anchored).toBeUndefined();
  });

  it("opens on what was raised most recently", () => {
    expect(BILL_REGISTER_INITIAL_SORT.columnId).toBe(BILL_COLUMN_IDENTIFIERS.createdAt);
    expect(BILL_REGISTER_INITIAL_SORT.direction).toBe("descending");
  });

  it("leads with THIS MATTER'S share and keeps the document's own total out of the way", () => {
    const share = column(BILL_COLUMN_IDENTIFIERS.matterShare);
    expect(share.label).toBe("This Matter");
    expect(share.hidden).toBe(false);
    // The whole document's total is a fact about the document, so inside a matter it arrives hidden
    // and named for what it covers — a reader who turns it on is asking about the difference.
    const whole = column(BILL_COLUMN_IDENTIFIERS.billTotal);
    expect(whole.label).toBe("Total (all matters)");
    expect(whole.hidden).toBe(true);

    const shared = makeRow(
      { totalMinor: 300_000 },
      {
        matterBalances: [
          {
            matterId: THIS_MATTER,
            matterNumber: null,
            matterTitle: null,
            totalMinor: 200_000,
            appliedMinor: 0,
            unpaidMinor: 200_000,
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
    expect(share.value(shared)).toBe(2000);
    expect(whole.value(shared)).toBe(3000);
  });

  it("sums every money column and nothing else", () => {
    const summed = COLUMNS.filter((candidate) => candidate.total === "sum").map(
      (candidate) => candidate.id,
    );
    expect(summed).toEqual([
      BILL_COLUMN_IDENTIFIERS.matterShare,
      BILL_COLUMN_IDENTIFIERS.matterUnpaid,
      BILL_COLUMN_IDENTIFIERS.billTotal,
      BILL_COLUMN_IDENTIFIERS.billUnpaid,
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

  it("swaps the money and the client over when the register is the firm's own", () => {
    const firm = (id: string) => {
      const found = FIRM_COLUMNS.find((candidate) => candidate.id === id);
      if (found === undefined) throw new Error(`The firm register has no ${id} column.`);
      return found;
    };
    // The same declaration, with the pair that can only be answered inside a matter put away and
    // the pair the document answers for itself brought forward.
    expect(firm(BILL_COLUMN_IDENTIFIERS.matterShare).hidden).toBe(true);
    expect(firm(BILL_COLUMN_IDENTIFIERS.matterUnpaid).hidden).toBe(true);
    expect(firm(BILL_COLUMN_IDENTIFIERS.billTotal).hidden).toBe(false);
    expect(firm(BILL_COLUMN_IDENTIFIERS.billTotal).label).toBe("Total");
    // The client is one repeated word inside a matter and the identifying fact across the firm.
    expect(column(BILL_COLUMN_IDENTIFIERS.client).hidden).toBe(true);
    expect(firm(BILL_COLUMN_IDENTIFIERS.client).hidden).toBe(false);
  });

  it("never answers the matter's question with the document's figure", () => {
    const firmShare = FIRM_COLUMNS.find(
      (candidate) => candidate.id === BILL_COLUMN_IDENTIFIERS.matterShare,
    );
    // A wrong answer is worse than no answer: outside a matter there is no share to state, and the
    // whole bill's total put in that column would read as one matter's charge.
    expect(firmShare?.value(makeRow({ totalMinor: 300_000 }))).toBeNull();
  });

  it("names the client on a firm row from the bill itself, and says so when the directory cannot", () => {
    const firmClient = FIRM_COLUMNS.find(
      (candidate) => candidate.id === BILL_COLUMN_IDENTIFIERS.client,
    );
    expect(firmClient?.value(makeRow({ clientName: "Redwood Holdings" }))).toBe("Redwood Holdings");
    // Never the identifier standing in for a name.
    expect(firmClient?.value(makeRow({ clientName: null }))).toBe("Unnamed client");
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
            matterNumber: null,
            matterTitle: null,
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

  it("keeps every verb on screen in every state, refusing rather than vanishing", () => {
    // One action bar, fixed geometry: an act a bill refuses is disabled with the reason, never
    // absent, so nothing moves as a reader walks from one bill to the next.
    const draft = billActions(makeRow({ status: "draft", invoiceNumber: null }), context).map(
      (action) => action.identifier,
    );
    const final = billActions(makeRow({}), context).map((action) => action.identifier);
    expect(draft).toEqual(final);
    expect(draft).toContain("adjust");
    expect(draft).toContain("creditNote");
  });

  it("refuses finalize on anything but a draft, and void on anything but a draft", () => {
    const onFinal = billActions(makeRow({}), context);
    expect(billAction(onFinal, "finalize")?.disabledReason).toContain("Only a draft can be finalized");
    expect(billAction(onFinal, "voidDraft")?.disabledReason).toContain("credit note");
  });

  it("keeps a not-yet-built capability on screen with what it waits on", () => {
    const payment = billAction(billActions(makeRow({}), context), "recordPayment");
    expect(payment?.soonDependency).toBe(BILL_DEPENDENCIES.payment);
    expect(payment === null ? true : isEnabled(payment)).toBe(false);
  });

  it("offers adjustment on a finalized bill with nothing applied, marked against its dependency", () => {
    const untouched = makeRow({});
    expect(isAdjustable(untouched)).toBe(true);
    const adjust = billAction(billActions(untouched, context), "adjust");
    expect(adjust?.soonDependency).toBe(BILL_DEPENDENCIES.adjustment);

    // The moment anything is applied the bill locks, and the refusal names the correction path.
    const applied = makeRow({ appliedMinor: 100_000 });
    expect(isAdjustable(applied)).toBe(false);
    expect(billAction(billActions(applied, context), "adjust")?.disabledReason).toContain(
      "credit note",
    );
  });

  it("refuses applying anything to a settled bill, and says why rather than hiding the verb", () => {
    const settled = makeRow({ appliedMinor: 100_000 });
    const applyTrust = billAction(billActions(settled, context), "applyTrust");
    expect(applyTrust?.disabledReason).toContain("settled");
  });

  it("names the capability an account is missing, so an administrator knows what to grant", () => {
    const withoutCredit = billActions(makeRow({}), {
      ...context,
      permissions: ["billing:read", "billing:draft"],
    });
    expect(billAction(withoutCredit, "creditNote")?.disabledReason).toContain("billing:credit");
  });

  it("refuses the client credit where the client is carrying none, and offers it where they are", () => {
    const without = billAction(billActions(makeRow({}), context), "applyClientCredit");
    expect(without?.disabledReason).toContain("no open credit");
    const withCredit = billAction(
      billActions(makeRow({}), { ...context, openClientCreditMinor: 120_000 }),
      "applyClientCredit",
    );
    expect(withCredit?.disabledReason).toBeUndefined();
    expect(withCredit?.label).toContain(money(120_000));
  });

  it("puts the draft verbs and the finalized verbs in the action bar, and the money in its tab", () => {
    const draftBar = invoiceBarActions(
      makeRow({ status: "draft", invoiceNumber: null }),
      context,
    ).map((action) => action.identifier);
    expect(draftBar).toEqual(["finalize", "voidDraft"]);

    const finalBar = invoiceBarActions(makeRow({}), context).map((action) => action.identifier);
    expect(finalBar).toEqual(["adjust", "recordDelivery", "print", "exportLedes"]);

    // A voided draft has no acts left; the bar states the record and nothing else.
    expect(invoiceBarActions(makeRow({ status: "void" }), context)).toEqual([]);

    const money = invoiceMoneyActions(makeRow({}), context).map((action) => action.identifier);
    expect(money).toEqual([
      "applyTrust",
      "recordPayment",
      "applyClientCredit",
      "writeOff",
      "creditNote",
    ]);
  });

  it("keeps the row menu to what belongs on a list", () => {
    // Every operation lives in the invoice window. The list opens the thing and copies its number,
    // plus the four acts a firm reaches for straight off a register.
    const menu = billRecordMenu(makeRow({}), context);
    const offered = menu.flatMap((group) => group.items.map((item) => item.identifier));
    expect(offered).toEqual([
      "open",
      "copyNumber",
      "finalize",
      "voidDraft",
      "recordDelivery",
      "applyTrust",
    ]);
    expect(offered).not.toContain("writeOff");
    expect(offered).not.toContain("creditNote");
    expect(offered).not.toContain("print");
  });

  it("groups the row menu so no separator ever bounds nothing", () => {
    const menu = billRecordMenu(makeRow({ status: "draft", invoiceNumber: null }), context);
    expect(menu.every((group) => group.items.length > 0)).toBe(true);
    expect(menuItem(menu, "open")).not.toBeNull();
    // A draft has drawn no number, so copying one is refused with the reason rather than removed.
    const copy = menuItem(menu, "copyNumber");
    expect(copy?.disabledReason).toContain("until it's finalized");
  });
});

describe("the Status column, and what the listing is asked for", () => {
  it("offers every standing whether or not a loaded bill carries it", () => {
    const standing = FIRM_COLUMNS.find((column) => column.id === BILL_COLUMN_IDENTIFIERS.standing);
    expect(standing?.filterValues).toEqual(["Draft", "Unpaid", "Partially Paid", "Paid", "Void"]);
  });

  it("sends every invoice status the selection reaches, once each, in the listing's order", () => {
    expect(invoiceStatusesForStandings({ kind: "set", values: ["Draft"] })).toEqual(["draft"]);
    // Unpaid, Partially Paid and Paid are all readings of a finalized bill.
    expect(invoiceStatusesForStandings({ kind: "set", values: ["Unpaid", "Paid"] })).toEqual([
      "final",
    ]);
    expect(invoiceStatusesForStandings({ kind: "set", values: ["Paid", "Draft"] })).toEqual([
      "draft",
      "final",
    ]);
    expect(invoiceStatusesForStandings({ kind: "set", values: [] })).toEqual([]);
    expect(invoiceStatusesForStandings(undefined)).toEqual([]);
  });

  it("seeds the filter from an address's statuses with every standing they can show", () => {
    expect(standingFilterForStatuses(["final"])).toEqual({
      kind: "set",
      values: ["Unpaid", "Partially Paid", "Paid"],
    });
    expect(standingFilterForStatuses(["draft", "void"])).toEqual({
      kind: "set",
      values: ["Draft", "Void"],
    });
    expect(standingFilterForStatuses(["stranger"])).toBeUndefined();
    expect(standingFilterForStatuses([])).toBeUndefined();
  });
});

describe("the client a bill is raised against", () => {
  const party = (role: string, entityId: string): MatterPartyEntry => ({
    id: `party_${entityId}`,
    matterId: THIS_MATTER,
    entityId,
    role,
    capacity: null,
    entityKind: "person",
    displayName: `Name of ${entityId}`,
  });

  it("is the party wearing the client role, however the firm cased or spaced it", () => {
    expect(clientPartyOf([party("Opposing party", "e1"), party(" CLIENT ", "e2")])).toEqual({
      entityId: "e2",
      displayName: "Name of e2",
    });
  });

  it("is nobody where no party wears the role, which is a matter that cannot be billed", () => {
    expect(clientPartyOf([party("Witness", "e1")])).toBeNull();
    expect(clientPartyOf([])).toBeNull();
  });
});
