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
  AgedWorkInProgress,
  ChangeLog,
  ClientList,
  MatterBillingGuide,
  MatterBillingTerms,
  ClientStatement,
  MattersList,
  OperationalVolumes,
  PaymentsApplied,
  Realization,
  Revenue,
  TimekeeperProductivity,
  TaskWorkload,
  DailyTime,
  MatterProductivity,
  WorkInProgress,
} from "./report-reads.ts";

const COMPUTED_AT = "2026-08-01T15:00:00.000Z";
const LIVE_STATEMENT =
  "This report shows the records as they stood when it was produced, at 2026-08-01T15:00:00.000Z. " +
  "They can change until they are billed, so it is a live report and is not claimed to reproduce.";

const MAIN = {
  locationId: "location_sample_main",
  locationName: "Main Office",
};
const NORTH = {
  locationId: "location_sample_north",
  locationName: "North Office",
};

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
      {
        ...MAIN,
        unpaidMinor: [900_000, 300_000, 180_000, 0, 95_000],
        totalMinor: 1_475_000,
      },
      {
        ...NORTH,
        unpaidMinor: [350_000, 120_000, 0, 60_000, 0],
        totalMinor: 530_000,
      },
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
        matters: [
          {
            ...matter(0, MAIN),
            figures: figures(900, 600_000, 30_000, 200_000, 830_000),
          },
        ],
      },
      {
        ...client(1),
        figures: figures(600, 400_000, 15_000, 0, 415_000),
        matters: [
          {
            ...matter(1, NORTH),
            figures: figures(600, 400_000, 15_000, 0, 415_000),
          },
        ],
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
        matters: [
          {
            ...matter(0, MAIN),
            figures: figures(750_000, 700_000, 50_000, 500_000),
          },
        ],
      },
      {
        ...client(1),
        figures: figures(350_000, 300_000, 0, 200_000),
        matters: [
          {
            ...matter(1, NORTH),
            figures: figures(350_000, 300_000, 0, 200_000),
          },
        ],
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

export function sampleDailyTime(): DailyTime {
  const figures = (entryCount: number, billableMinutes: number, nonBillableMinutes: number) => {
    const totalMinutes = billableMinutes + nonBillableMinutes;
    return {
      entryCount,
      billableMinutes,
      nonBillableMinutes,
      totalMinutes,
      billableShareBasisPoints:
        totalMinutes === 0 ? null : Math.round((billableMinutes * 10000) / totalMinutes),
    };
  };
  const one = {
    timekeeperUserId: "user_sample_one",
    timekeeperName: samplePerson(0).name,
  };
  const two = {
    timekeeperUserId: "user_sample_two",
    timekeeperName: samplePerson(1).name,
  };
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    computedAt: COMPUTED_AT,
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    completeness: { scope: "complete" },
    totals: figures(4, 210, 60),
    days: [
      {
        workDate: "2026-07-14",
        figures: figures(3, 150, 60),
        timekeepers: [
          { ...one, figures: figures(2, 120, 60) },
          { ...two, figures: figures(1, 30, 0) },
        ],
      },
      {
        workDate: "2026-07-15",
        figures: figures(1, 60, 0),
        timekeepers: [{ ...one, figures: figures(1, 60, 0) }],
      },
    ],
    timekeepers: [
      { ...one, dayCount: 2, figures: figures(3, 180, 60) },
      { ...two, dayCount: 1, figures: figures(1, 30, 0) },
    ],
  };
}

export function sampleMatterProductivity(): MatterProductivity {
  const day = sampleDailyTime();
  const first = day.timekeepers[0] ?? { timekeeperUserId: "user_sample_one", timekeeperName: null };
  return {
    periodStart: day.periodStart,
    periodEnd: day.periodEnd,
    computedAt: day.computedAt,
    reproducible: false,
    statement: day.statement,
    locationId: null,
    completeness: day.completeness,
    totals: day.totals,
    matters: [
      {
        ...matter(0, MAIN),
        ...client(0),
        figures: day.days[0]?.figures ?? day.totals,
        timekeepers: day.days[0]?.timekeepers ?? [],
      },
      {
        ...matter(1, NORTH),
        ...client(1),
        figures: day.days[1]?.figures ?? day.totals,
        timekeepers: [
          {
            timekeeperUserId: first.timekeeperUserId,
            timekeeperName: first.timekeeperName,
            figures: day.days[1]?.figures ?? day.totals,
          },
        ],
      },
    ],
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
  ): InvoiceFigures => ({
    invoiceCount,
    billedMinor,
    creditedMinor,
    appliedMinor,
    unpaidMinor,
  });
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
            matters: [
              {
                ...matter(0, MAIN),
                figures: figures(1, 400_000, 50_000, 350_000, 0),
              },
            ],
          },
          {
            invoiceId: "invoice_sample_2",
            invoiceNumber: "00045",
            issueDate: "2026-07-24",
            dueDate: "2026-08-23",
            figures: figures(1, 300_000, 0, 150_000, 150_000),
            matters: [
              {
                ...matter(0, MAIN),
                figures: figures(1, 300_000, 0, 150_000, 150_000),
              },
            ],
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
            matters: [
              {
                ...matter(1, NORTH),
                figures: figures(1, 300_000, 0, 200_000, 100_000),
              },
            ],
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
        figures: figures({
          entryCount: 1,
          trustTransferMinor: 200_000,
          totalMinor: 200_000,
        }),
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
        figures: figures({
          entryCount: 1,
          trustTransferMinor: 200_000,
          totalMinor: 200_000,
        }),
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

export function sampleClientStatement(): ClientStatement {
  const { matterId, matterTitle, matterNumber } = matter(0, MAIN);
  const matters = [{ matterId, matterTitle, matterNumber }];
  const line = (
    index: number,
    values: Pick<
      ClientStatement["activity"][number],
      "kind" | "date" | "invoiceNumber" | "chargedMinor" | "appliedMinor" | "balanceMinor"
    > &
      Partial<ClientStatement["activity"][number]>,
  ): ClientStatement["activity"][number] => ({
    reversesKind: null,
    invoiceId: `invoice_sample_${values.invoiceNumber ?? "draft"}`,
    applicationId: values.kind === "invoice" ? null : `invoiceApplication_sample_${String(index)}`,
    matters,
    reason: null,
    ...values,
  });
  const bill = (number: string, chargedMinor: number, date: string, balanceMinor: number) =>
    line(0, {
      kind: "invoice",
      date,
      invoiceNumber: number,
      chargedMinor,
      appliedMinor: null,
      balanceMinor,
    });
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    ...client(0),
    currency: "USD",
    ...REPRODUCIBLE_JULY,
    completeness: { scope: "complete" },
    totals: {
      openingMinor: 420_000,
      billedMinor: 1_245_000,
      invoiceCount: 3,
      appliedMinor: 900_000,
      applicationCount: 5,
      closingMinor: 765_000,
    },
    activity: [
      line(1, {
        kind: "payment",
        date: "2026-07-03",
        invoiceNumber: "00038",
        chargedMinor: null,
        appliedMinor: 420_000,
        balanceMinor: 0,
      }),
      bill("00041", 845_000, "2026-07-10", 845_000),
      bill("00042", 320_000, "2026-07-10", 1_165_000),
      line(2, {
        kind: "credit_note",
        date: "2026-07-18",
        invoiceNumber: "00042",
        chargedMinor: null,
        appliedMinor: 60_000,
        balanceMinor: 1_105_000,
      }),
      line(3, {
        kind: "write_off",
        date: "2026-07-20",
        invoiceNumber: "00041",
        chargedMinor: null,
        appliedMinor: 10_000,
        balanceMinor: 1_095_000,
        reason: "Courtesy discount",
      }),
      line(4, {
        kind: "reversal",
        reversesKind: "write_off",
        date: "2026-07-22",
        invoiceNumber: "00041",
        chargedMinor: null,
        appliedMinor: -10_000,
        balanceMinor: 1_105_000,
        reason: "Discount withdrawn",
      }),
      line(5, {
        kind: "trust_transfer",
        date: "2026-07-24",
        invoiceNumber: "00041",
        chargedMinor: null,
        appliedMinor: 420_000,
        balanceMinor: 685_000,
      }),
      bill("00047", 80_000, "2026-07-31", 765_000),
    ],
    unpaidInvoices: [
      {
        invoiceId: "invoice_sample_00041",
        invoiceNumber: "00041",
        issueDate: "2026-07-10",
        dueDate: "2026-08-09",
        matters,
        agingBucket: "current",
        billedMinor: 845_000,
        paidAndCreditedMinor: 420_000,
        unpaidMinor: 425_000,
      },
      {
        invoiceId: "invoice_sample_00042",
        invoiceNumber: "00042",
        issueDate: "2026-07-10",
        dueDate: "2026-08-09",
        matters,
        agingBucket: "current",
        billedMinor: 320_000,
        paidAndCreditedMinor: 60_000,
        unpaidMinor: 260_000,
      },
      {
        invoiceId: "invoice_sample_00047",
        invoiceNumber: "00047",
        issueDate: "2026-07-31",
        dueDate: "2026-08-30",
        matters,
        agingBucket: "current",
        billedMinor: 80_000,
        paidAndCreditedMinor: 0,
        unpaidMinor: 80_000,
      },
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

export function sampleMattersList(): MattersList {
  const row = (
    index: number,
    office: { locationId: string; locationName: string },
    status: "open" | "hold" | "closed",
  ) => ({
    ...matter(index, office),
    ...client(index),
    status,
    matterTypeName: index % 2 === 0 ? "Litigation" : "Estate planning",
    responsibleMemberId: `user_sample_${String(index)}`,
    responsibleName: samplePerson(index).name,
    openedAt: "2026-02-03T17:00:00.000Z",
    closedAt: status === "closed" ? "2026-07-14T17:00:00.000Z" : null,
  });
  return {
    computedAt: COMPUTED_AT,
    reproducible: false,
    statement:
      "This report lists the firm's matters as they stood when it was produced, at 2026-08-01T15:00:00.000Z. " +
      "A matter can be retyped, moved to another office, closed or reopened, so it is a live report and is not claimed to reproduce.",
    locationId: null,
    completeness: { scope: "complete" },
    totals: { matterCount: 3, openCount: 1, heldCount: 1, closedCount: 1 },
    offices: [
      {
        ...MAIN,
        counts: { matterCount: 2, openCount: 1, heldCount: 0, closedCount: 1 },
      },
      {
        ...NORTH,
        counts: { matterCount: 1, openCount: 0, heldCount: 1, closedCount: 0 },
      },
    ],
    matters: [row(0, MAIN, "open"), row(1, NORTH, "hold"), row(2, MAIN, "closed")],
  };
}

export function sampleAgedWorkInProgress(): AgedWorkInProgress {
  const figures = (a: number, b: number, c: number, d: number, totalMinor: number) => ({
    unbilledMinor: [a, b, c, d],
    totalMinor,
  });
  return {
    computedAt: COMPUTED_AT,
    asOfDate: "2026-08-01",
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    currency: "USD",
    completeness: { scope: "complete" },
    totals: figures(700_000, 300_000, 145_000, 100_000, 1_245_000),
    offices: [
      { ...MAIN, figures: figures(500_000, 200_000, 30_000, 100_000, 830_000) },
      { ...NORTH, figures: figures(200_000, 100_000, 115_000, 0, 415_000) },
    ],
    clients: [
      {
        ...client(0),
        figures: figures(500_000, 200_000, 30_000, 100_000, 830_000),
        matters: [
          {
            ...matter(0, MAIN),
            figures: figures(500_000, 200_000, 30_000, 100_000, 830_000),
          },
        ],
      },
      {
        ...client(1),
        figures: figures(200_000, 100_000, 115_000, 0, 415_000),
        matters: [
          {
            ...matter(1, NORTH),
            figures: figures(200_000, 100_000, 115_000, 0, 415_000),
          },
        ],
      },
    ],
  };
}

export function sampleClientList(): ClientList {
  const counts = (open: number, held: number, closed: number) => ({
    matterCount: open + held + closed,
    openCount: open,
    heldCount: held,
    closedCount: closed,
  });
  return {
    computedAt: COMPUTED_AT,
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    completeness: { scope: "complete" },
    clientCount: 2,
    totals: counts(2, 0, 1),
    mattersWithoutClient: 0,
    clients: [
      {
        clientEntityId: client(0).clientEntityId,
        displayName: sampleMatter(0).client,
        entityKind: "organization",
        legalName: null,
        emailAddress: "office@example.com",
        phoneNumber: "+1 775 555 0100",
        city: "Reno",
        region: "NV",
        country: "US",
        counts: counts(1, 0, 1),
        locationNames: [MAIN.locationName],
      },
      {
        clientEntityId: client(1).clientEntityId,
        displayName: sampleMatter(1).client,
        entityKind: "person",
        legalName: null,
        emailAddress: null,
        phoneNumber: null,
        city: null,
        region: null,
        country: null,
        counts: counts(1, 0, 0),
        locationNames: [NORTH.locationName, MAIN.locationName],
      },
    ],
  };
}

export function sampleTaskWorkload(): TaskWorkload {
  return {
    computedAt: COMPUTED_AT,
    reproducible: false,
    statement: LIVE_STATEMENT,
    locationId: null,
    completeness: { scope: "complete" },
    totals: { openCount: 9, overdueCount: 2, undatedCount: 3 },
    people: [
      {
        assigneeUserId: "user_sample_one",
        assigneeName: samplePerson(0).name,
        openCount: 6,
        overdueCount: 2,
        undatedCount: 1,
      },
      {
        assigneeUserId: "user_sample_two",
        assigneeName: samplePerson(1).name,
        openCount: 2,
        overdueCount: 0,
        undatedCount: 1,
      },
      { assigneeUserId: null, assigneeName: null, openCount: 1, overdueCount: 0, undatedCount: 1 },
    ],
  };
}

/** Aged Expenses wears Aged Work in Progress's shape; its sample is the costs-only reading of it. */
export function sampleAgedExpenses(): AgedWorkInProgress {
  return sampleAgedWorkInProgress();
}

export function sampleChangeLog(): ChangeLog {
  const one = { actorUserId: "user_sample_one", actorName: samplePerson(0).name };
  const two = { actorUserId: "user_sample_two", actorName: samplePerson(1).name };
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    computedAt: COMPUTED_AT,
    reproducible: true,
    statement:
      "This report covers changes recorded from 2026-07-01 to 2026-07-31 (UTC days), as the change " +
      "history stood when it was produced, at 2026-08-01T15:00:00.000Z. The period had ended, and the " +
      "change history is never edited, so running the same period again returns the same changes. " +
      "Names are as they stood when this report was produced.",
    completeness: { scope: "complete" },
    totals: { directoryCount: 2, matterCount: 3, accountCount: 1, totalCount: 6 },
    families: [
      { family: "directory", label: "People and organizations", changeCount: 2 },
      { family: "matters", label: "Matters", changeCount: 3 },
      { family: "accounts", label: "Accounts", changeCount: 1 },
    ],
    people: [
      { ...one, directoryCount: 2, matterCount: 1, accountCount: 0, totalCount: 3 },
      { ...two, directoryCount: 0, matterCount: 1, accountCount: 1, totalCount: 2 },
      {
        actorUserId: null,
        actorName: null,
        directoryCount: 0,
        matterCount: 1,
        accountCount: 0,
        totalCount: 1,
      },
    ],
    entries: [
      {
        ...two,
        id: "auditLog_sample_six",
        at: "2026-07-30T16:20:00.000Z",
        family: "matters",
        event: "matter.closed",
        eventLabel: "Matter closed",
        subjectId: "matter_sample_one",
      },
      {
        ...two,
        id: "auditLog_sample_five",
        at: "2026-07-22T10:05:00.000Z",
        family: "accounts",
        event: "trust.authorization_policy_changed",
        eventLabel: "Trust approval rule changed",
        subjectId: "trustAuthorizationPolicy_sample",
      },
      {
        actorUserId: null,
        actorName: null,
        id: "auditLog_sample_four",
        at: "2026-07-18T03:00:00.000Z",
        family: "matters",
        event: "matter.updated",
        eventLabel: "Matter details changed",
        subjectId: "matter_sample_two",
      },
      {
        ...one,
        id: "auditLog_sample_three",
        at: "2026-07-14T14:45:00.000Z",
        family: "matters",
        event: "matter.opened",
        eventLabel: "Matter opened",
        subjectId: "matter_sample_two",
      },
      {
        ...one,
        id: "auditLog_sample_two",
        at: "2026-07-09T09:30:00.000Z",
        family: "directory",
        event: "directory.address.updated",
        eventLabel: "Address changed",
        subjectId: "directoryAddress_sample",
      },
      {
        ...one,
        id: "auditLog_sample_one",
        at: "2026-07-02T11:00:00.000Z",
        family: "directory",
        event: "directory.person.created",
        eventLabel: "Person added",
        subjectId: "directoryPerson_sample",
      },
    ],
  };
}

export function sampleRevenue(): Revenue {
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    locationId: null,
    currency: "USD",
    ...REPRODUCIBLE_JULY,
    attributionStatement:
      "Collected counts payments, transfers from trust and client credits applied to bills in the period, less any reversal of them. Credit notes and write-offs are shown as credited and are not counted as collected. Each matter's money is counted under the matter type and responsible attorney the matter has now.",
    completeness: { scope: "complete" },
    totals: { billedMinor: 1_850_000, collectedMinor: 1_200_000, creditedMinor: 75_000 },
    offices: [
      {
        ...MAIN,
        figures: { billedMinor: 1_300_000, collectedMinor: 850_000, creditedMinor: 50_000 },
      },
      {
        ...NORTH,
        figures: { billedMinor: 550_000, collectedMinor: 350_000, creditedMinor: 25_000 },
      },
    ],
    matterTypes: [
      {
        matterTypeId: "matterType_sample_litigation",
        matterTypeName: "Litigation",
        matterCount: 3,
        figures: { billedMinor: 1_100_000, collectedMinor: 700_000, creditedMinor: 50_000 },
      },
      {
        matterTypeId: "matterType_sample_estates",
        matterTypeName: "Estates",
        matterCount: 2,
        figures: { billedMinor: 600_000, collectedMinor: 400_000, creditedMinor: 25_000 },
      },
      {
        matterTypeId: null,
        matterTypeName: null,
        matterCount: 1,
        figures: { billedMinor: 150_000, collectedMinor: 100_000, creditedMinor: 0 },
      },
    ],
    responsibleAttorneys: [
      {
        responsibleMemberId: "user_sample_0",
        responsibleName: samplePerson(0).name,
        matterCount: 4,
        figures: { billedMinor: 1_250_000, collectedMinor: 800_000, creditedMinor: 50_000 },
      },
      {
        responsibleMemberId: "user_sample_1",
        responsibleName: samplePerson(1).name,
        matterCount: 2,
        figures: { billedMinor: 600_000, collectedMinor: 400_000, creditedMinor: 25_000 },
      },
    ],
  };
}

/** Matter Billing Guide: one matter under each kind of agreement, and one with none recorded. */
export function sampleMatterBillingGuide(): MatterBillingGuide {
  const terms = (
    index: number,
    kind: MatterBillingTerms["kind"],
    fields: Partial<MatterBillingTerms>,
    validFrom = "2026-02-03",
  ): MatterBillingTerms => ({
    arrangementId: `billingArrangement_sample_${String(index)}`,
    version: 1,
    kind,
    flatFeeAmountMinor: null,
    contingencyShareE4: null,
    contingencyBasis: null,
    retainerTargetMinor: null,
    retainerThresholdMinor: null,
    advanceDepositDestination: null,
    currency: "USD",
    validFrom,
    validTo: null,
    ...fields,
  });
  const row = (
    index: number,
    office: { locationId: string; locationName: string },
    arrangement: MatterBillingTerms | null,
    nextArrangement: MatterBillingTerms | null = null,
  ) => ({
    ...matter(index, office),
    ...client(index),
    status: index === 3 ? ("hold" as const) : ("open" as const),
    responsibleName: samplePerson(index).name,
    arrangement,
    nextArrangement,
    rates:
      index === 0
        ? [
            {
              rateId: "rate_sample_0",
              rateCardId: "rateCard_sample_standard",
              rateCardName: "Standard",
              tier: "matter" as const,
              rateE4: 4_500_000,
              currency: "USD",
              validFrom: "2026-01-01",
              validTo: null,
            },
          ]
        : [],
  });
  return {
    computedAt: COMPUTED_AT,
    asOfDate: "2026-08-01",
    reproducible: false,
    statement:
      "This report shows how each open and held matter is billed on 2026-08-01, as recorded when it was produced, at 2026-08-01T15:00:00.000Z. " +
      "A fee agreement can be amended, a matter moved or closed and a rate card changed, so it is a live report and is not claimed to reproduce.",
    locationId: null,
    completeness: { scope: "complete" },
    totals: {
      matterCount: 5,
      hourlyCount: 1,
      flatFeeCount: 1,
      contingencyCount: 1,
      retainerCount: 1,
      noneRecordedCount: 1,
    },
    matters: [
      row(
        0,
        MAIN,
        terms(0, "hourly", {}),
        terms(0, "flat_fee", { version: 2, flatFeeAmountMinor: 900_000 }, "2026-09-01"),
      ),
      row(
        1,
        NORTH,
        terms(1, "flat_fee", { flatFeeAmountMinor: 250_000, advanceDepositDestination: "trust" }),
      ),
      row(
        2,
        MAIN,
        terms(2, "contingency", { contingencyShareE4: 3333, contingencyBasis: "net_after_costs" }),
      ),
      row(
        3,
        NORTH,
        terms(3, "retainer", {
          retainerTargetMinor: 500_000,
          retainerThresholdMinor: 100_000,
          advanceDepositDestination: "trust",
        }),
      ),
      row(4, MAIN, null),
    ],
  };
}
