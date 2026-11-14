/*
 * THE REPORT REGISTRY — every report the platform offers, declared once as data.
 *
 * The screens render from this. `/reports` lists it grouped by family; `/reports/<id>` draws the
 * report's controls from its declaration, reads through its `read` port and arranges the answer
 * through its `present` port. Adding a report is one entry here plus a presenter; a second screen
 * per report is what this file exists to make unnecessary, on the same reasoning as the sidebar's
 * destinations registry: one shape, decided once, corrected once.
 *
 * ONLY REAL THINGS. A report whose backend is built carries both ports and opens. A report the
 * reporting design named and nobody has built yet is still declared — at stage `soon`, with what
 * it waits on, and with no ports, by type: a report that cannot be read cannot be presented, and
 * the union makes that combination unrepresentable rather than remembered. It renders in the
 * catalogue visible and disabled, which is the standing rule for a designed-but-unwired surface.
 *
 * THE TEMPORAL CONTRACT IS DECLARED, NOT INFERRED. A bitemporal report takes a knowledge instant
 * and the run screen draws the control; a live-only report does not accept one and the control is
 * absent, because a read that cannot honor an instant must never be offered one.
 */
import type { Component } from "svelte";
import Landmark from "@lucide/svelte/icons/landmark";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import Clock from "@lucide/svelte/icons/clock";
import ChartColumn from "@lucide/svelte/icons/chart-column";
import type { ApiOutcome } from "$lib/api/request.ts";
// Type-only: elided at build, so the plugin-less test config never resolves the alias.
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import type { ReportPresentation } from "./report-presentation.ts";
import type { ReportScope } from "./report-scope.ts";
import {
  readTrustCompliancePack,
  TRUST_COMPLIANCE_PERMISSION,
  type TrustCompliancePack,
} from "./reports-api.ts";
import { sampleTrustCompliancePack } from "./trust-compliance-fixture.ts";
import {
  presentMattersList,
  presentOperationalVolumes,
  presentDailyTime,
  presentMatterProductivity,
  presentTimekeeperProductivity,
} from "./activity-presenters.ts";
import {
  presentAccountsReceivableAging,
  presentAgedWorkInProgress,
  presentRealization,
  presentWorkInProgress,
} from "./financial-presenters.ts";
import {
  presentInvoices,
  presentMatterBalances,
  presentPaymentsApplied,
} from "./billing-presenters.ts";
import {
  FINANCIAL_REPORTS_PERMISSION,
  OPERATIONAL_REPORTS_PERMISSION,
  PRODUCTIVITY_REPORTS_PERMISSION,
  readAccountsReceivableAging,
  readAgedWorkInProgress,
  readInvoices,
  readMatterBalances,
  readMattersList,
  readOperationalVolumes,
  readPaymentsApplied,
  readRealization,
  readDailyTime,
  readMatterProductivity,
  readTimekeeperProductivity,
  readWorkInProgress,
  type AccountsReceivableAging,
  type AgedWorkInProgress,
  type Invoices,
  type MatterBalances,
  type MattersList,
  type OperationalVolumes,
  type PaymentsApplied,
  type Realization,
  type DailyTime,
  type MatterProductivity,
  type TimekeeperProductivity,
  type WorkInProgress,
} from "./report-reads.ts";
import {
  sampleAccountsReceivableAging,
  sampleAgedWorkInProgress,
  sampleInvoices,
  sampleMatterBalances,
  sampleMattersList,
  sampleOperationalVolumes,
  samplePaymentsApplied,
  sampleRealization,
  sampleDailyTime,
  sampleMatterProductivity,
  sampleTimekeeperProductivity,
  sampleWorkInProgress,
} from "./report-samples.ts";
import { presentTrustCompliancePack, type ReportCaptions } from "./trust-compliance-presenter.ts";

export type ReportFamily = "trust-compliance" | "financial" | "productivity" | "operational";

/** The families in the order the catalogue shows them, each with its heading and its glyph. */
export const REPORT_FAMILIES: ReadonlyArray<{
  readonly id: ReportFamily;
  readonly label: string;
  readonly icon: Component;
}> = [
  { id: "trust-compliance", label: "Trust Compliance", icon: Landmark },
  { id: "financial", label: "Financial", icon: ReceiptText },
  { id: "productivity", label: "Productivity", icon: Clock },
  { id: "operational", label: "Operational", icon: ChartColumn },
];

/**
 * Whether the report takes a knowledge instant. `bitemporal` reads re-derive for a stated period
 * and instant; `live-only` reads are over mutable stores and are stamped with the instant they were
 * computed at instead.
 */
export type ReportTemporal = "bitemporal" | "live-only";

/** Which controls the run screen draws beside the period. */
export interface ReportScopeControls {
  /** The report is about one trust account, picked from the firm's roster. */
  readonly trustAccount: boolean;
  /** The rows can be narrowed to one office. A filter, never a gate: the default is every office. */
  readonly office: boolean;
  /**
   * What the report is asked over on the effective axis: a span of days, one date (aging is owed
   * AT a date, and the scope's period is that one day), or nothing (work in progress is now).
   */
  readonly period: "span" | "date" | "none";
}

/** The port that fetches a report over a scope. */
export type ReportReader<Payload> = (
  fetchImpl: typeof fetch,
  scope: ReportScope,
) => Promise<ApiOutcome<Payload>>;

/** The port that arranges a payload for the screen and the file. */
export type ReportPresenter<Payload> = (
  payload: Payload,
  captions: ReportCaptions,
) => ReportPresentation;

interface ReportDeclarationBase {
  /** The route segment: `/reports/<id>`. Kebab-case, spelled in full. */
  readonly id: string;
  readonly family: ReportFamily;
  /** The screen's title, taken from here and nowhere else. */
  readonly name: string;
  /** One line: the question the report answers. On the catalogue row. */
  readonly answers: string;
  /** The `reports:*` key the server enforces on the read. */
  readonly permission: string;
  readonly temporal: ReportTemporal;
}

/** A report the platform can run today. */
export interface BuiltReportDeclaration extends ReportDeclarationBase {
  readonly stage: Exclude<MaturityStage, "soon">;
  readonly scope: ReportScopeControls;
  /** Runs the read and the presenter together, so the payload type never leaves the declaration. */
  readonly run: (
    fetchImpl: typeof fetch,
    scope: ReportScope,
    captions: ReportCaptions,
  ) => Promise<ApiOutcome<ReportPresentation>>;
  /** The presentation over sample words, for the run screen's fixture. */
  readonly fixture: (captions: ReportCaptions) => ReportPresentation;
}

/** A report the design named and nobody has built. */
export interface SoonReportDeclaration extends ReportDeclarationBase {
  readonly stage: "soon";
  /** What it waits on, as a noun phrase the Soon composition completes into a sentence. */
  readonly waitsOn: string;
}

export type ReportDeclaration = BuiltReportDeclaration | SoonReportDeclaration;

/**
 * Pairs a reader with its presenter under one payload type, so a declaration cannot present a
 * payload it did not read.
 */
function built<Payload>(
  declaration: Omit<BuiltReportDeclaration, "run" | "fixture"> & {
    readonly read: ReportReader<Payload>;
    readonly present: ReportPresenter<Payload>;
    readonly samplePayload: () => Payload;
  },
): BuiltReportDeclaration {
  const { read, present, samplePayload, ...rest } = declaration;
  return {
    ...rest,
    run: async (fetchImpl, scope, captions) => {
      const outcome = await read(fetchImpl, scope);
      if (outcome.kind !== "ok") return outcome;
      return { kind: "ok", value: present(outcome.value, captions) };
    },
    fixture: (captions) => present(samplePayload(), captions),
  };
}

const trustCompliance = built<TrustCompliancePack>({
  id: "trust-compliance",
  family: "trust-compliance",
  name: "Trust Compliance Report",
  answers:
    "For one trust account over one period: every movement of client money, each client and matter ledger, each reconciliation, and anything that didn't balance.",
  permission: TRUST_COMPLIANCE_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: true, office: false, period: "span" },
  read: (fetchImpl, scope) => {
    // A scope with no subject never reaches here: the run screen reads only when the scope is
    // complete. The check stands so a caller that skips the screen gets a typed refusal, not a 404
    // for an account named "null".
    if (scope.subject === null) {
      throw new Error("the trust-compliance report is about one trust account, and none was named");
    }
    // What the pack lists (ledgers at zero, the authorizers) is the firm's report policy, applied
    // on the server and recorded on the provenance section; the screen states neither, so the
    // firm's document reads the same every time it is produced.
    return readTrustCompliancePack(fetchImpl, {
      trustAccountId: scope.subject,
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      ...(scope.knownAsOf === null ? {} : { knownAsOf: scope.knownAsOf }),
    });
  },
  present: presentTrustCompliancePack,
  samplePayload: () => sampleTrustCompliancePack(),
});

const accountsReceivableAging = built<AccountsReceivableAging>({
  id: "accounts-receivable-aging",
  family: "financial",
  name: "Accounts Receivable Aging",
  answers: "What the firm is owed and for how long, by client, matter and office, as of a date.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "date" },
  // The scope's period is the one day the aging is taken at.
  read: (fetchImpl, scope) =>
    readAccountsReceivableAging(fetchImpl, {
      asOfDate: scope.period.to,
      knownAsOf: scope.knownAsOf,
      locationId: scope.office,
    }),
  present: (payload) => presentAccountsReceivableAging(payload),
  samplePayload: sampleAccountsReceivableAging,
});

const workInProgress = built<WorkInProgress>({
  id: "work-in-progress",
  family: "financial",
  name: "Work in Progress",
  answers: "Unbilled time and costs, by matter, client, timekeeper and office, as they stand now.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "none" },
  read: (fetchImpl, scope) => readWorkInProgress(fetchImpl, { locationId: scope.office }),
  present: presentWorkInProgress,
  samplePayload: sampleWorkInProgress,
});

const agedWorkInProgress = built<AgedWorkInProgress>({
  id: "aged-work-in-progress",
  family: "financial",
  name: "Aged Work in Progress",
  answers:
    "Unbilled time and costs by how long ago the work was done, by matter, client and office, as they stand now.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "none" },
  read: (fetchImpl, scope) => readAgedWorkInProgress(fetchImpl, { locationId: scope.office }),
  present: (payload) => presentAgedWorkInProgress(payload),
  samplePayload: sampleAgedWorkInProgress,
});

const realization = built<Realization>({
  id: "realization",
  family: "financial",
  name: "Realization",
  answers:
    "For a period: the standard value of time recorded, what was billed, credited or written off, and what was applied.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readRealization(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      knownAsOf: scope.knownAsOf,
      locationId: scope.office,
    }),
  present: (payload) => presentRealization(payload),
  samplePayload: sampleRealization,
});

const timekeeperProductivity = built<TimekeeperProductivity>({
  id: "timekeeper-productivity",
  family: "productivity",
  name: "Timekeeper Productivity",
  answers:
    "Hours recorded by each timekeeper in a period, billable and non-billable, by client, task code and office.",
  permission: PRODUCTIVITY_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readTimekeeperProductivity(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      locationId: scope.office,
    }),
  present: presentTimekeeperProductivity,
  samplePayload: sampleTimekeeperProductivity,
});

const dailyTime = built<DailyTime>({
  id: "daily-time",
  family: "productivity",
  name: "Daily Time",
  answers:
    "Hours recorded on each day of a period, by timekeeper, billable and non-billable, and how many days each timekeeper recorded time on.",
  permission: PRODUCTIVITY_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readDailyTime(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      locationId: scope.office,
    }),
  present: presentDailyTime,
  samplePayload: sampleDailyTime,
});

const matterProductivity = built<MatterProductivity>({
  id: "matter-productivity",
  family: "productivity",
  name: "Matter Productivity",
  answers:
    "Hours recorded on each matter in a period, billable and non-billable, and who recorded them.",
  permission: PRODUCTIVITY_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readMatterProductivity(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      locationId: scope.office,
    }),
  present: presentMatterProductivity,
  samplePayload: sampleMatterProductivity,
});

const operationalVolumes = built<OperationalVolumes>({
  id: "operational-volumes",
  family: "operational",
  name: "Operational Volumes",
  answers:
    "Firm activity in a period: matters opened and closed, bills drafted and finalized, trust movements, disbursement requests and reconciliations.",
  permission: OPERATIONAL_REPORTS_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readOperationalVolumes(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      knownAsOf: scope.knownAsOf,
      locationId: scope.office,
    }),
  present: (payload) => presentOperationalVolumes(payload),
  samplePayload: sampleOperationalVolumes,
});

const invoices = built<Invoices>({
  id: "invoices",
  family: "financial",
  name: "Invoices",
  answers:
    "All bills issued in a period, by office and client: what was billed, credited, applied and still unpaid at the end of the period.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readInvoices(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      knownAsOf: scope.knownAsOf,
      locationId: scope.office,
    }),
  present: (payload) => presentInvoices(payload),
  samplePayload: sampleInvoices,
});

const paymentsApplied = built<PaymentsApplied>({
  id: "payments-applied",
  family: "financial",
  name: "Payments Applied",
  answers:
    "Everything applied to bills in a period, by office and client: payments, trust transfers, credits, write-offs and reversals.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "bitemporal",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "span" },
  read: (fetchImpl, scope) =>
    readPaymentsApplied(fetchImpl, {
      periodStart: scope.period.from,
      periodEnd: scope.period.to,
      knownAsOf: scope.knownAsOf,
      locationId: scope.office,
    }),
  present: (payload) => presentPaymentsApplied(payload),
  samplePayload: samplePaymentsApplied,
});

const matterBalances = built<MatterBalances>({
  id: "matter-balances",
  family: "financial",
  name: "Matter Balances",
  answers:
    "Where each matter stands now: its unbilled work, what its bills still owe, and what is held for it in trust, per office and client.",
  permission: FINANCIAL_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "none" },
  read: (fetchImpl, scope) => readMatterBalances(fetchImpl, { locationId: scope.office }),
  present: (payload) => presentMatterBalances(payload),
  samplePayload: sampleMatterBalances,
});

const mattersList = built<MattersList>({
  id: "matters-list",
  family: "operational",
  name: "Matters List",
  answers:
    "Every matter the firm has opened, with its client, type, office, responsible attorney and the days it opened and closed.",
  permission: OPERATIONAL_REPORTS_PERMISSION,
  temporal: "live-only",
  stage: "alpha",
  scope: { trustAccount: false, office: true, period: "none" },
  read: (fetchImpl, scope) => readMattersList(fetchImpl, { locationId: scope.office }),
  present: (payload) => presentMattersList(payload),
  samplePayload: sampleMattersList,
});

const REPORT_LIST = [
  trustCompliance,
  accountsReceivableAging,
  workInProgress,
  agedWorkInProgress,
  realization,
  invoices,
  paymentsApplied,
  matterBalances,
  timekeeperProductivity,
  dailyTime,
  matterProductivity,
  operationalVolumes,
  mattersList,
] as const satisfies readonly ReportDeclaration[];

/** Every report, in catalogue order. */
export const REPORTS: readonly ReportDeclaration[] = REPORT_LIST;

/** The literal union of report ids, so a link to a report is a type error when it names none. */
export type ReportId = (typeof REPORT_LIST)[number]["id"];

export function reportById(id: string): ReportDeclaration | null {
  return REPORTS.find((report) => report.id === id) ?? null;
}

/** The reports in one family, in catalogue order. */
export function reportsInFamily(family: ReportFamily): readonly ReportDeclaration[] {
  return REPORTS.filter((report) => report.family === family);
}

export function reportHref(report: ReportDeclaration): string {
  return `/reports/${report.id}`;
}

/** Whether a declaration is one the platform can run today. */
export function isBuiltReport(report: ReportDeclaration): report is BuiltReportDeclaration {
  return report.stage !== "soon";
}
