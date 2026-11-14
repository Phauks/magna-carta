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
  OperationalVolumes,
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
      "The standard value is the time recorded as it stands now, so it is live even when the rest of this report reproduces.",
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
      "Matters opened and closed and costs incurred are counted as those records stood when this report was produced.",
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
