/*
 * Sample payloads for the financial, productivity and operational reports: the run screen's
 * loading fixture and the presenters' tests. Sample words only (the design system's own sample
 * people and matters, invented office names), never a firm's figures. Every group adds up to its
 * total, because the fixture is drawn through the same presenter as the answer and a test over it
 * asserts the presenter printed the payload's figures.
 */
import { sampleMatter, samplePerson } from "@magna-carta/design-system/loading-fixtures";
import type {
  AccountsReceivableAging,
  AppliedFigures,
  InvoiceFigures,
  Invoices,
  MatterBalances,
  OperationalVolumes,
  PaymentsApplied,
  Realization,
  TimekeeperProductivity,
  WorkInProgress,
} from "./report-reads.ts";

const COMPUTED_AT = "2026-08-01T15:00:00.000Z";
const LIVE_STATEMENT =
  "This report shows the records as they stood when it was produced, at 2026-08-01T15:00:00.000Z. " +
  "They can change until they are billed, so it is a live report and is not claimed to reproduce.";

const MAIN = { locationId: "location_sample_main", locationName: "Main Office" };
const NORTH = { locationId: "location_sample_north", locationName: "North Office" };

function matter(index: number, office: { locationId: string; locationName: string }) {
  const sample = sampleMatter(index);
  return {
    matterId: `matter_sample_${String(index)}`,
    matterTitle: sample.title,
    matterNumber: sample.number,
    ...office,
  };
}

function client(index: number) {
  return {
    clientEntityId: `entity_sample_${String(index)}`,
    clientName: sampleMatter(index).client,
  };
}

export function sampleAccountsReceivableAging(): AccountsReceivableAging {
  return {
    asOfDate: "2026-07-31",
    locationId: null,
    currency: "USD",
    reproducibility: {
      reproducible: false,
      periodStart: "2026-07-31",
      periodEnd: "2026-07-31",
      computedAt: COMPUTED_AT,
    },
    reproducibilityStatement: LIVE_STATEMENT,
    completeness: { scope: "complete" },
    totals: {
      unpaidMinor: [1_250_000, 420_000, 180_000, 60_000, 95_000],
      totalMinor: 2_005_000,
      invoiceCount: [6, 3, 2, 1, 1],
    },
    offices: [
      { ...MAIN, unpaidMinor: [900_000, 300_000, 180_000, 0, 95_000], totalMinor: 1_475_000 },
      { ...NORTH, unpaidMinor: [350_000, 120_000, 0, 60_000, 0], totalMinor: 530_000 },
    ],
    clients: [
      {
        ...client(0),
        unpaidMinor: [900_000, 300_000, 180_000, 0, 95_000],
        totalMinor: 1_475_000,
        matters: [
          {
            ...matter(0, MAIN),
            unpaidMinor: [900_000, 300_000, 180_000, 0, 95_000],
            totalMinor: 1_475_000,
          },
        ],
      },
      {
        ...client(1),
        unpaidMinor: [350_000, 120_000, 0, 60_000, 0],
        totalMinor: 530_000,
        matters: [
          {
            ...matter(1, NORTH),
            unpaidMinor: [350_000, 120_000, 0, 60_000, 0],
            totalMinor: 530_000,
          },
        ],
      },
    ],
  };
}

export function sampleWorkInProgress(): WorkInProgress {
  const figures = (
    timeMinutes: number,
    timeMinor: number,
    costMinor: number,
    onDraftMinor: number,
    totalMinor: number,
  ) => ({
    timeMinutes,
    timeMinor,
    costMinor,
    onDraftMinor,
    totalMinor,
  });
  return {
    computedAt: COMPUTED_AT,
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    currency: "USD",
    completeness: { scope: "complete" },
    totals: figures(1_500, 1_000_000, 45_000, 200_000, 1_245_000),
    offices: [
      { ...MAIN, figures: figures(900, 600_000, 30_000, 200_000, 830_000) },
      { ...NORTH, figures: figures(600, 400_000, 15_000, 0, 415_000) },
    ],
    clients: [
      {
        ...client(0),
        figures: figures(900, 600_000, 30_000, 200_000, 830_000),
        matters: [{ ...matter(0, MAIN), figures: figures(900, 600_000, 30_000, 200_000, 830_000) }],
      },
      {
        ...client(1),
        figures: figures(600, 400_000, 15_000, 0, 415_000),
        matters: [{ ...matter(1, NORTH), figures: figures(600, 400_000, 15_000, 0, 415_000) }],
      },
    ],
    timekeepers: [
      {
        timekeeperUserId: "user_sample_one",
        timekeeperName: samplePerson(0).name,
        figures: figures(1_500, 1_000_000, 0, 200_000, 1_200_000),
      },
    ],
  };
}

export function sampleRealization(): Realization {
  const figures = (
    standardValueMinor: number,
    billedMinor: number,
    creditedMinor: number,
    appliedMinor: number,
  ) => ({
    standardValueMinor,
    billedMinor,
    creditedMinor,
    appliedMinor,
  });
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    locationId: null,
    currency: "USD",
    reproducibility: {
      reproducible: false,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      computedAt: COMPUTED_AT,
    },
    reproducibilityStatement: LIVE_STATEMENT,
    standardValueIsLive: true,
    standardValueStatement:
      "The standard value uses time as recorded now, so it can change even when the rest of this report can't.",
    completeness: { scope: "complete" },
    totals: figures(1_100_000, 1_000_000, 50_000, 700_000),
    offices: [
      { ...MAIN, figures: figures(750_000, 700_000, 50_000, 500_000) },
      { ...NORTH, figures: figures(350_000, 300_000, 0, 200_000) },
    ],
    clients: [
      {
        ...client(0),
        figures: figures(750_000, 700_000, 50_000, 500_000),
        matters: [{ ...matter(0, MAIN), figures: figures(750_000, 700_000, 50_000, 500_000) }],
      },
      {
        ...client(1),
        figures: figures(350_000, 300_000, 0, 200_000),
        matters: [{ ...matter(1, NORTH), figures: figures(350_000, 300_000, 0, 200_000) }],
      },
    ],
  };
}

export function sampleTimekeeperProductivity(): TimekeeperProductivity {
  const figures = (
    entryCount: number,
    billableMinutes: number,
    nonBillableMinutes: number,
    billableShareBasisPoints: number | null,
  ) => ({
    entryCount,
    billableMinutes,
    nonBillableMinutes,
    totalMinutes: billableMinutes + nonBillableMinutes,
    billableShareBasisPoints,
  });
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    computedAt: COMPUTED_AT,
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    completeness: { scope: "complete" },
    totals: figures(4, 210, 60, 7778),
    timekeepers: [
      {
        timekeeperUserId: "user_sample_one",
        timekeeperName: samplePerson(0).name,
        matterCount: 2,
        figures: figures(3, 180, 60, 7500),
      },
      {
        timekeeperUserId: "user_sample_two",
        timekeeperName: samplePerson(1).name,
        matterCount: 1,
        figures: figures(1, 30, 0, 10000),
      },
    ],
    offices: [
      { ...MAIN, figures: figures(2, 120, 60, 6667) },
      { ...NORTH, figures: figures(2, 90, 0, 10000) },
    ],
    clients: [
      { ...client(0), figures: figures(2, 120, 60, 6667) },
      { ...client(1), figures: figures(2, 90, 0, 10000) },
    ],
    nonBillableCategories: [
      { categoryId: "category_sample", categoryName: "Training", minutes: 60 },
    ],
    taskCodes: [{ code: null, label: null, figures: figures(4, 210, 60, 7778) }],
  };
}

export function sampleOperationalVolumes(): OperationalVolumes {
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    locationId: null,
    reproducibility: {
      reproducible: false,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      computedAt: COMPUTED_AT,
    },
    reproducibilityStatement: LIVE_STATEMENT,
    liveSections: ["matters", "costs"],
    liveSectionsStatement:
      "Matters opened and closed and costs incurred are counted as they were when this report was produced.",
    completeness: { scope: "complete" },
    matters: [
      {
        measure: "opened",
        matterTypeId: "matterType_sample",
        matterTypeName: "Litigation",
        count: 4,
      },
      {
        measure: "closed",
        matterTypeId: "matterType_sample",
        matterTypeName: "Litigation",
        count: 2,
      },
    ],
    billing: {
      billsDrafted: 12,
      billsFinalized: 10,
      draftsVoided: 1,
      creditNotesIssued: 1,
      writeOffs: 0,
    },
    trust: [
      { measure: "movement", detail: "deposit", count: 8 },
      { measure: "movement", detail: "disbursement", count: 5 },
      { measure: "reconciliation-closed", detail: null, count: 1 },
    ],
    costs: [{ disbursementClass: "hard", count: 6 }],
  };
}

const REPRODUCIBLE_JULY = {
  reproducibility: {
    reproducible: true as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    knownAsOf: "2026-08-01T06:59:59.999Z",
  },
  reproducibilityStatement:
    "This report covers July 1 to July 31, 2026, as the records stood at 2026-08-01T06:59:59.999Z. " +
    "Run again with the same dates it reads the same.",
};

export function sampleInvoices(): Invoices {
  const figures = (
    invoiceCount: number,
    billedMinor: number,
    creditedMinor: number,
    appliedMinor: number,
    unpaidMinor: number,
  ): InvoiceFigures => ({ invoiceCount, billedMinor, creditedMinor, appliedMinor, unpaidMinor });
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    locationId: null,
    currency: "USD",
    ...REPRODUCIBLE_JULY,
    completeness: { scope: "complete" },
    totals: figures(3, 1_000_000, 50_000, 700_000, 250_000),
    offices: [
      { ...MAIN, figures: figures(2, 700_000, 50_000, 500_000, 150_000) },
      { ...NORTH, figures: figures(1, 300_000, 0, 200_000, 100_000) },
    ],
    clients: [
      {
        ...client(0),
        figures: figures(2, 700_000, 50_000, 500_000, 150_000),
        invoices: [
          {
            invoiceId: "invoice_sample_1",
            invoiceNumber: "00041",
            issueDate: "2026-07-03",
            dueDate: "2026-08-02",
            figures: figures(1, 400_000, 50_000, 350_000, 0),
            matters: [{ ...matter(0, MAIN), figures: figures(1, 400_000, 50_000, 350_000, 0) }],
          },
          {
            invoiceId: "invoice_sample_2",
            invoiceNumber: "00045",
            issueDate: "2026-07-24",
            dueDate: "2026-08-23",
            figures: figures(1, 300_000, 0, 150_000, 150_000),
            matters: [{ ...matter(0, MAIN), figures: figures(1, 300_000, 0, 150_000, 150_000) }],
          },
        ],
      },
      {
        ...client(1),
        figures: figures(1, 300_000, 0, 200_000, 100_000),
        invoices: [
          {
            invoiceId: "invoice_sample_3",
            invoiceNumber: "00043",
            issueDate: "2026-07-15",
            dueDate: "2026-08-14",
            figures: figures(1, 300_000, 0, 200_000, 100_000),
            matters: [{ ...matter(1, NORTH), figures: figures(1, 300_000, 0, 200_000, 100_000) }],
          },
        ],
      },
    ],
  };
}

export function samplePaymentsApplied(): PaymentsApplied {
  const figures = (values: Partial<AppliedFigures>): AppliedFigures => ({
    entryCount: 0,
    paymentMinor: 0,
    trustTransferMinor: 0,
    clientCreditMinor: 0,
    creditNoteMinor: 0,
    writeOffMinor: 0,
    reversalMinor: 0,
    totalMinor: 0,
    ...values,
  });
  const entry = (
    index: number,
    values: Pick<
      PaymentsApplied["entries"][number],
      "kind" | "reversesKind" | "effectiveDate" | "amountMinor" | "reason" | "invoiceNumber"
    >,
    clientIndex: number,
    office: { locationId: string; locationName: string },
  ) => ({
    applicationId: `invoiceApplication_sample_${String(index)}`,
    invoiceId: `invoice_sample_${values.invoiceNumber ?? "draft"}`,
    ...client(clientIndex),
    ...matter(clientIndex, office),
    ...values,
  });
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    locationId: null,
    currency: "USD",
    ...REPRODUCIBLE_JULY,
    completeness: { scope: "complete" },
    totals: figures({
      entryCount: 5,
      paymentMinor: 500_000,
      trustTransferMinor: 200_000,
      writeOffMinor: 50_000,
      reversalMinor: -100_000,
      totalMinor: 650_000,
    }),
    offices: [
      {
        ...MAIN,
        figures: figures({
          entryCount: 4,
          paymentMinor: 500_000,
          writeOffMinor: 50_000,
          reversalMinor: -100_000,
          totalMinor: 450_000,
        }),
      },
      {
        ...NORTH,
        figures: figures({ entryCount: 1, trustTransferMinor: 200_000, totalMinor: 200_000 }),
      },
    ],
    clients: [
      {
        ...client(0),
        figures: figures({
          entryCount: 4,
          paymentMinor: 500_000,
          writeOffMinor: 50_000,
          reversalMinor: -100_000,
          totalMinor: 450_000,
        }),
      },
      {
        ...client(1),
        figures: figures({ entryCount: 1, trustTransferMinor: 200_000, totalMinor: 200_000 }),
      },
    ],
    entries: [
      entry(
        1,
        {
          kind: "payment",
          reversesKind: null,
          effectiveDate: "2026-07-08",
          amountMinor: 350_000,
          reason: null,
          invoiceNumber: "00041",
        },
        0,
        MAIN,
      ),
      entry(
        2,
        {
          kind: "write_off",
          reversesKind: null,
          effectiveDate: "2026-07-08",
          amountMinor: 50_000,
          reason: "Agreed discount",
          invoiceNumber: "00041",
        },
        0,
        MAIN,
      ),
      entry(
        3,
        {
          kind: "trust_transfer",
          reversesKind: null,
          effectiveDate: "2026-07-18",
          amountMinor: 200_000,
          reason: null,
          invoiceNumber: "00043",
        },
        1,
        NORTH,
      ),
      entry(
        4,
        {
          kind: "payment",
          reversesKind: null,
          effectiveDate: "2026-07-26",
          amountMinor: 250_000,
          reason: null,
          invoiceNumber: "00045",
        },
        0,
        MAIN,
      ),
      entry(
        5,
        {
          kind: "reversal",
          reversesKind: "payment",
          effectiveDate: "2026-07-29",
          amountMinor: -100_000,
          reason: "Check returned unpaid",
          invoiceNumber: "00045",
        },
        0,
        MAIN,
      ),
    ],
  };
}

export function sampleMatterBalances(): MatterBalances {
  const figures = (unbilledMinor: number, owedMinor: number, trustMinor: number) => ({
    unbilledMinor,
    owedMinor,
    trustMinor,
  });
  return {
    computedAt: COMPUTED_AT,
    asOfDate: "2026-08-01",
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    currency: "USD",
    completeness: { scope: "complete" },
    totals: figures(1_245_000, 690_000, 1_150_000),
    offices: [
      { ...MAIN, figures: figures(830_000, 450_000, 800_000) },
      { ...NORTH, figures: figures(415_000, 240_000, 350_000) },
    ],
    clients: [
      {
        ...client(0),
        figures: figures(830_000, 450_000, 800_000),
        matters: [
          { ...matter(0, MAIN), figures: figures(830_000, 300_000, 500_000) },
          { ...matter(2, MAIN), figures: figures(0, 150_000, 300_000) },
        ],
      },
      {
        ...client(1),
        figures: figures(415_000, 240_000, 350_000),
        matters: [{ ...matter(1, NORTH), figures: figures(415_000, 240_000, 350_000) }],
      },
    ],
  };
}
