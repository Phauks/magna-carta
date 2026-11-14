/*
 * The financial, productivity and operational reads.
 *
 * Mirrors `reports.accountsReceivableAging`, `reports.workInProgress`, `reports.realization`,
 * `reports.timekeeperProductivity` and `reports.operationalVolumes` in
 * apps/api-worker/openapi/openapi.json. apps/web hand-writes the shapes it reads (the transport seam
 * in $lib/api/request.ts says why). Field names stay as served.
 *
 * THE OFFICE IS A FILTER, NEVER A GATE. Each read takes an optional office; absent, it is the whole
 * firm with every office subtotalled.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
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

function withOptional(
  search: URLSearchParams,
  values: Readonly<Record<string, string | null | undefined>>,
): string {
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) search.set(name, value);
  }
  return search.toString();
}

export function readAccountsReceivableAging(
  fetchImpl: typeof fetch,
  query: { asOfDate: string; knownAsOf: string | null; locationId: string | null },
): Promise<ApiOutcome<AccountsReceivableAging>> {
  const search = withOptional(new URLSearchParams({ asOfDate: query.asOfDate }), {
    knownAsOf: query.knownAsOf,
    locationId: query.locationId,
  });
  return requestJson(fetchImpl, `/api/v1/reports/accounts-receivable-aging?${search}`);
}

export function readWorkInProgress(
  fetchImpl: typeof fetch,
  query: { locationId: string | null },
): Promise<ApiOutcome<WorkInProgress>> {
  const search = withOptional(new URLSearchParams(), { locationId: query.locationId });
  return requestJson(
    fetchImpl,
    search === ""
      ? "/api/v1/reports/work-in-progress"
      : `/api/v1/reports/work-in-progress?${search}`,
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
  const search = withOptional(
    new URLSearchParams({ periodStart: query.periodStart, periodEnd: query.periodEnd }),
    { knownAsOf: query.knownAsOf, locationId: query.locationId },
  );
  return requestJson(fetchImpl, `/api/v1/reports/realization?${search}`);
}

/** Live only: the read takes no knowledge instant, so this call cannot pass one. */
export function readTimekeeperProductivity(
  fetchImpl: typeof fetch,
  query: Omit<PeriodQuery, "knownAsOf">,
): Promise<ApiOutcome<TimekeeperProductivity>> {
  const search = withOptional(
    new URLSearchParams({ periodStart: query.periodStart, periodEnd: query.periodEnd }),
    { locationId: query.locationId },
  );
  return requestJson(fetchImpl, `/api/v1/reports/timekeeper-productivity?${search}`);
}

export function readOperationalVolumes(
  fetchImpl: typeof fetch,
  query: PeriodQuery,
): Promise<ApiOutcome<OperationalVolumes>> {
  const search = withOptional(
    new URLSearchParams({ periodStart: query.periodStart, periodEnd: query.periodEnd }),
    { knownAsOf: query.knownAsOf, locationId: query.locationId },
  );
  return requestJson(fetchImpl, `/api/v1/reports/operational-volumes?${search}`);
}
