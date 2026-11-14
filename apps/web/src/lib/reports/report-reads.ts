/*
 * The financial, productivity and operational reads.
 *
 * Mirrors `reports.accountsReceivableAging`, `reports.workInProgress`, `reports.realization`,
 * `reports.timekeeperProductivity`, `reports.operationalVolumes`, `reports.invoices`,
 * `reports.paymentsApplied`, `reports.matterBalances`, `reports.mattersList`,
 * `reports.agedWorkInProgress` and `reports.dailyTime` in
 * apps/api-worker/openapi/openapi.json, called through the generated client. Field names stay as
 * served.
 *
 * THE OFFICE IS A FILTER, NEVER A GATE. Each read takes an optional office; absent, it is the whole
 * firm with every office subtotalled.
 */
import {
  reportsAccountsReceivableAging,
  reportsAgedWorkInProgress,
  reportsDailyTime,
  reportsInvoices,
  reportsMatterBalances,
  reportsMattersList,
  reportsOperationalVolumes,
  reportsPaymentsApplied,
  reportsRealization,
  reportsTimekeeperProductivity,
  reportsWorkInProgress,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import type { ReportCompleteness } from "./report-presentation.ts";
import type { ReportReproducibility } from "./reports-api.ts";

export const FINANCIAL_REPORTS_PERMISSION = "reports:financial";
export const PRODUCTIVITY_REPORTS_PERMISSION = "reports:productivity";
export const OPERATIONAL_REPORTS_PERMISSION = "reports:operational";

/** The five aging buckets, in order, as the server labels them. */
export const AGING_BUCKET_LABELS = [
  "Current",
  "1 to 30 days",
  "31 to 60 days",
  "61 to 90 days",
  "Over 90 days",
] as const;

/** Five integers, in bucket order. */
export type AgingFigures = readonly [number, number, number, number, number];

export interface AgingMatterRow {
  matterId: string;
  matterTitle: string;
  matterNumber: string | null;
  locationId: string | null;
  locationName: string | null;
  unpaidMinor: AgingFigures;
  totalMinor: number;
}

export interface AccountsReceivableAging {
  asOfDate: string;
  locationId: string | null;
  currency: "USD";
  reproducibility: ReportReproducibility;
  reproducibilityStatement: string;
  completeness: ReportCompleteness;
  totals: {
    unpaidMinor: AgingFigures;
    totalMinor: number;
    invoiceCount: AgingFigures | null;
  };
  offices: {
    locationId: string | null;
    locationName: string | null;
    unpaidMinor: AgingFigures;
    totalMinor: number;
  }[];
  clients: {
    clientEntityId: string;
    clientName: string | null;
    unpaidMinor: AgingFigures;
    totalMinor: number;
    matters: AgingMatterRow[];
  }[];
}

export interface WorkInProgressFigures {
  timeMinutes: number;
  timeMinor: number;
  costMinor: number;
  onDraftMinor: number;
  totalMinor: number;
}

export interface WorkInProgress {
  computedAt: string;
  reproducible: false;
  statement: string;
  locationId: string | null;
  currency: "USD";
  completeness: ReportCompleteness;
  totals: WorkInProgressFigures;
  offices: {
    locationId: string | null;
    locationName: string | null;
    figures: WorkInProgressFigures;
  }[];
  clients: {
    clientEntityId: string | null;
    clientName: string | null;
    figures: WorkInProgressFigures;
    matters: {
      matterId: string;
      matterTitle: string;
      matterNumber: string | null;
      locationId: string | null;
      locationName: string | null;
      figures: WorkInProgressFigures;
    }[];
  }[];
  timekeepers: {
    timekeeperUserId: string;
    timekeeperName: string | null;
    figures: WorkInProgressFigures;
  }[];
}

/** Three facts per matter, never added to one another. */
export interface MatterBalanceFigures {
  unbilledMinor: number;
  owedMinor: number;
  trustMinor: number;
}

export interface MatterBalances {
  computedAt: string;
  asOfDate: string;
  reproducible: false;
  statement: string;
  locationId: string | null;
  currency: "USD";
  completeness: ReportCompleteness;
  totals: MatterBalanceFigures;
  offices: {
    locationId: string | null;
    locationName: string | null;
    figures: MatterBalanceFigures;
  }[];
  clients: {
    clientEntityId: string | null;
    clientName: string | null;
    figures: MatterBalanceFigures;
    matters: {
      matterId: string;
      matterTitle: string;
      matterNumber: string | null;
      locationId: string | null;
      locationName: string | null;
      figures: MatterBalanceFigures;
    }[];
  }[];
}

export interface MatterStatusCounts {
  matterCount: number;
  openCount: number;
  heldCount: number;
  closedCount: number;
}

export interface MatterListRow {
  matterId: string;
  matterNumber: string | null;
  matterTitle: string;
  status: "open" | "hold" | "closed";
  matterTypeName: string | null;
  clientEntityId: string | null;
  clientName: string | null;
  locationId: string | null;
  locationName: string | null;
  responsibleMemberId: string;
  responsibleName: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export interface MattersList {
  computedAt: string;
  reproducible: false;
  statement: string;
  locationId: string | null;
  completeness: ReportCompleteness;
  totals: MatterStatusCounts;
  offices: { locationId: string | null; locationName: string | null; counts: MatterStatusCounts }[];
  matters: MatterListRow[];
}

/** Four buckets in a fixed order: 0 to 30, 31 to 60, 61 to 90 and over 90 days since the work. */
export interface AgedWorkFigures {
  unbilledMinor: number[];
  totalMinor: number;
}

export interface AgedWorkInProgress {
  computedAt: string;
  asOfDate: string;
  reproducible: false;
  statement: string;
  locationId: string | null;
  currency: "USD";
  completeness: ReportCompleteness;
  totals: AgedWorkFigures;
  offices: { locationId: string | null; locationName: string | null; figures: AgedWorkFigures }[];
  clients: {
    clientEntityId: string | null;
    clientName: string | null;
    figures: AgedWorkFigures;
    matters: {
      matterId: string;
      matterTitle: string;
      matterNumber: string | null;
      locationId: string | null;
      locationName: string | null;
      figures: AgedWorkFigures;
    }[];
  }[];
}

export interface RealizationFigures {
  standardValueMinor: number;
  billedMinor: number;
  creditedMinor: number;
  appliedMinor: number;
}

export interface Realization {
  periodStart: string;
  periodEnd: string;
  locationId: string | null;
  currency: "USD";
  reproducibility: ReportReproducibility;
  reproducibilityStatement: string;
  standardValueIsLive: true;
  standardValueStatement: string;
  completeness: ReportCompleteness;
  totals: RealizationFigures;
  offices: {
    locationId: string | null;
    locationName: string | null;
    figures: RealizationFigures;
  }[];
  clients: {
    clientEntityId: string | null;
    clientName: string | null;
    figures: RealizationFigures;
    matters: {
      matterId: string;
      matterTitle: string;
      matterNumber: string | null;
      locationId: string | null;
      locationName: string | null;
      figures: RealizationFigures;
    }[];
  }[];
}

export interface ProductivityFigures {
  entryCount: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  totalMinutes: number;
  /** 10000 is all of it; null where nothing was recorded. */
  billableShareBasisPoints: number | null;
}

export interface TimekeeperProductivity {
  periodStart: string;
  periodEnd: string;
  computedAt: string;
  reproducible: false;
  statement: string;
  locationId: string | null;
  completeness: ReportCompleteness;
  totals: ProductivityFigures;
  timekeepers: {
    timekeeperUserId: string;
    timekeeperName: string | null;
    matterCount: number;
    figures: ProductivityFigures;
  }[];
  offices: {
    locationId: string | null;
    locationName: string | null;
    figures: ProductivityFigures;
  }[];
  clients: {
    clientEntityId: string | null;
    clientName: string | null;
    figures: ProductivityFigures;
  }[];
  nonBillableCategories: {
    categoryId: string | null;
    categoryName: string | null;
    minutes: number;
  }[];
  taskCodes: {
    code: string | null;
    label: string | null;
    figures: ProductivityFigures;
  }[];
}

export interface DailyTime {
  periodStart: string;
  periodEnd: string;
  computedAt: string;
  reproducible: false;
  statement: string;
  locationId: string | null;
  completeness: ReportCompleteness;
  totals: ProductivityFigures;
  /** Every day with time on it, oldest first. */
  days: {
    workDate: string;
    figures: ProductivityFigures;
    timekeepers: {
      timekeeperUserId: string;
      timekeeperName: string | null;
      figures: ProductivityFigures;
    }[];
  }[];
  timekeepers: {
    timekeeperUserId: string;
    timekeeperName: string | null;
    dayCount: number;
    figures: ProductivityFigures;
  }[];
}

export type OperationalSection = "matters" | "billing" | "trust" | "costs";

export interface OperationalVolumes {
  periodStart: string;
  periodEnd: string;
  locationId: string | null;
  reproducibility: ReportReproducibility;
  reproducibilityStatement: string;
  liveSections: OperationalSection[];
  liveSectionsStatement: string;
  completeness: ReportCompleteness;
  matters: {
    measure: "opened" | "closed";
    matterTypeId: string | null;
    matterTypeName: string | null;
    count: number;
  }[];
  billing: {
    billsDrafted: number;
    billsFinalized: number;
    draftsVoided: number;
    creditNotesIssued: number;
    writeOffs: number;
  };
  trust: {
    measure:
      | "movement"
      | "disbursement-requested"
      | "disbursement-decided"
      | "reconciliation-opened"
      | "reconciliation-closed";
    detail: string | null;
    count: number;
  }[];
  costs: { disbursementClass: "hard" | "soft"; count: number }[];
}

export interface InvoiceFigures {
  invoiceCount: number;
  billedMinor: number;
  creditedMinor: number;
  appliedMinor: number;
  unpaidMinor: number;
}

export interface InvoiceRow {
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  figures: InvoiceFigures;
  matters: {
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
    locationId: string | null;
    locationName: string | null;
    figures: InvoiceFigures;
  }[];
}

export interface Invoices {
  periodStart: string;
  periodEnd: string;
  locationId: string | null;
  currency: "USD";
  reproducibility: ReportReproducibility;
  reproducibilityStatement: string;
  completeness: ReportCompleteness;
  totals: InvoiceFigures;
  offices: { locationId: string | null; locationName: string | null; figures: InvoiceFigures }[];
  clients: {
    clientEntityId: string;
    clientName: string | null;
    figures: InvoiceFigures;
    invoices: InvoiceRow[];
  }[];
}

export type ApplicationKind =
  | "trust_transfer"
  | "payment"
  | "credit_note"
  | "client_credit"
  | "write_off"
  | "reversal";

export interface AppliedFigures {
  entryCount: number;
  paymentMinor: number;
  trustTransferMinor: number;
  clientCreditMinor: number;
  creditNoteMinor: number;
  writeOffMinor: number;
  reversalMinor: number;
  totalMinor: number;
}

export interface AppliedEntry {
  applicationId: string;
  kind: ApplicationKind;
  reversesKind: Exclude<ApplicationKind, "reversal"> | null;
  effectiveDate: string;
  amountMinor: number;
  reason: string | null;
  invoiceId: string;
  invoiceNumber: string | null;
  clientEntityId: string;
  clientName: string | null;
  matterId: string;
  matterTitle: string;
  matterNumber: string | null;
  locationId: string | null;
  locationName: string | null;
}

export interface PaymentsApplied {
  periodStart: string;
  periodEnd: string;
  locationId: string | null;
  currency: "USD";
  reproducibility: ReportReproducibility;
  reproducibilityStatement: string;
  completeness: ReportCompleteness;
  totals: AppliedFigures;
  offices: { locationId: string | null; locationName: string | null; figures: AppliedFigures }[];
  clients: { clientEntityId: string; clientName: string | null; figures: AppliedFigures }[];
  entries: AppliedEntry[];
}

/** A null filter is left off the query: the contract reads an absent parameter as "the whole firm". */
function present(value: string | null): string | undefined {
  return value ?? undefined;
}

/*
 * Each read goes through the generated client (`@magna-carta/api-client`), handed the route's own
 * fetch so the load's preload reaches it. The wire shapes above are this surface's reading of the
 * response; the presenters are written against them.
 */
async function outcome<T>(call: () => Promise<{ data: unknown }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data as T };
  } catch (error) {
    return outcomeOf<T>(error);
  }
}

export function readAccountsReceivableAging(
  fetchImpl: typeof fetch,
  query: { asOfDate: string; knownAsOf: string | null; locationId: string | null },
): Promise<ApiOutcome<AccountsReceivableAging>> {
  return outcome(() =>
    reportsAccountsReceivableAging({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        asOfDate: query.asOfDate,
        knownAsOf: present(query.knownAsOf),
        locationId: present(query.locationId),
      },
    }),
  );
}

export function readWorkInProgress(
  fetchImpl: typeof fetch,
  query: { locationId: string | null },
): Promise<ApiOutcome<WorkInProgress>> {
  return outcome(() =>
    reportsWorkInProgress({
      fetch: fetchImpl,
      throwOnError: true,
      query: { locationId: present(query.locationId) },
    }),
  );
}

export function readMatterBalances(
  fetchImpl: typeof fetch,
  query: { locationId: string | null },
): Promise<ApiOutcome<MatterBalances>> {
  return outcome(() =>
    reportsMatterBalances({
      fetch: fetchImpl,
      throwOnError: true,
      query: { locationId: present(query.locationId) },
    }),
  );
}

export function readMattersList(
  fetchImpl: typeof fetch,
  query: { locationId: string | null },
): Promise<ApiOutcome<MattersList>> {
  return outcome(() =>
    reportsMattersList({
      fetch: fetchImpl,
      throwOnError: true,
      query: { locationId: present(query.locationId) },
    }),
  );
}

export function readAgedWorkInProgress(
  fetchImpl: typeof fetch,
  query: { locationId: string | null },
): Promise<ApiOutcome<AgedWorkInProgress>> {
  return outcome(() =>
    reportsAgedWorkInProgress({
      fetch: fetchImpl,
      throwOnError: true,
      query: { locationId: present(query.locationId) },
    }),
  );
}

interface PeriodQuery {
  periodStart: string;
  periodEnd: string;
  knownAsOf: string | null;
  locationId: string | null;
}

export function readRealization(
  fetchImpl: typeof fetch,
  query: PeriodQuery,
): Promise<ApiOutcome<Realization>> {
  return outcome(() =>
    reportsRealization({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        knownAsOf: present(query.knownAsOf),
        locationId: present(query.locationId),
      },
    }),
  );
}

/** Live only: the read takes no knowledge instant, so this call cannot pass one. */
export function readTimekeeperProductivity(
  fetchImpl: typeof fetch,
  query: Omit<PeriodQuery, "knownAsOf">,
): Promise<ApiOutcome<TimekeeperProductivity>> {
  return outcome(() =>
    reportsTimekeeperProductivity({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        locationId: present(query.locationId),
      },
    }),
  );
}

/** Live only, as Timekeeper Productivity is. */
export function readDailyTime(
  fetchImpl: typeof fetch,
  query: Omit<PeriodQuery, "knownAsOf">,
): Promise<ApiOutcome<DailyTime>> {
  return outcome(() =>
    reportsDailyTime({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        locationId: present(query.locationId),
      },
    }),
  );
}

export function readOperationalVolumes(
  fetchImpl: typeof fetch,
  query: PeriodQuery,
): Promise<ApiOutcome<OperationalVolumes>> {
  return outcome(() =>
    reportsOperationalVolumes({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        knownAsOf: present(query.knownAsOf),
        locationId: present(query.locationId),
      },
    }),
  );
}

export function readInvoices(
  fetchImpl: typeof fetch,
  query: PeriodQuery,
): Promise<ApiOutcome<Invoices>> {
  return outcome(() =>
    reportsInvoices({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        knownAsOf: present(query.knownAsOf),
        locationId: present(query.locationId),
      },
    }),
  );
}

export function readPaymentsApplied(
  fetchImpl: typeof fetch,
  query: PeriodQuery,
): Promise<ApiOutcome<PaymentsApplied>> {
  return outcome(() =>
    reportsPaymentsApplied({
      fetch: fetchImpl,
      throwOnError: true,
      query: {
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        knownAsOf: present(query.knownAsOf),
        locationId: present(query.locationId),
      },
    }),
  );
}
