/*
 * A problem report as the routes answer it: the stored row turned into the contract's list row and
 * full view, with the sealed words opened through the audited readers in incident-statements.ts.
 * The JSON columns were written by the intake route and are parsed defensively all the same: a
 * value that is not what it should be is left out rather than failing the read.
 */
import type { IncidentDetailValue, IncidentSummaryValue } from "./incident-contract.ts";
import {
  isIncidentStatus,
  readIncidentDescription,
  readIncidentStatusNote,
  type IncidentRow,
  type IncidentStatus,
} from "./incident-statements.ts";
import type { ProtectedReadContext } from "./protected-fields.ts";

/** How much of the reporter's words a list row shows. */
const SUMMARY_LENGTH = 140;

interface ReportContext {
  readonly route: string | null;
  readonly appVersion: string | null;
  readonly deployment: string | null;
}

function parsedContext(row: IncidentRow): ReportContext {
  try {
    const value = JSON.parse(row.context) as Record<string, unknown>;
    const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
    return { route: text("route"), appVersion: text("appVersion"), deployment: text("deployment") };
  } catch {
    return { route: null, appVersion: null, deployment: null };
  }
}

function parsedArray<T>(json: string, keep: (value: unknown) => value is T): T[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter(keep) : [];
  } catch {
    return [];
  }
}

const isText = (value: unknown): value is string => typeof value === "string";
const isCrumb = (value: unknown): value is { at: string; action: string; route: string } =>
  typeof value === "object" &&
  value !== null &&
  isText((value as Record<string, unknown>).at) &&
  isText((value as Record<string, unknown>).action) &&
  isText((value as Record<string, unknown>).route);

function statusOf(row: IncidentRow): IncidentStatus {
  return isIncidentStatus(row.status) ? row.status : "open";
}

export async function incidentSummaryOf(
  context: ProtectedReadContext,
  row: IncidentRow,
): Promise<IncidentSummaryValue> {
  const description = await readIncidentDescription(context, row);
  return {
    id: row.id,
    createdAt: row.created_at,
    status: statusOf(row),
    statusChangedAt: row.status_changed_at,
    reportedBy: row.reported_by,
    reporterName: row.reporter_name,
    summary: description === null ? null : description.slice(0, SUMMARY_LENGTH),
    route: parsedContext(row).route,
    errorIdCount: parsedArray(row.error_ids, isText).length,
    hasScreenshot: row.screenshot_key !== null,
  };
}

export async function incidentDetailOf(
  context: ProtectedReadContext,
  row: IncidentRow,
): Promise<IncidentDetailValue> {
  const reportContext = parsedContext(row);
  return {
    id: row.id,
    createdAt: row.created_at,
    status: statusOf(row),
    statusChangedAt: row.status_changed_at,
    answeredByName: row.answerer_name,
    statusNote: await readIncidentStatusNote(context, row),
    reportedBy: row.reported_by,
    reporterName: row.reporter_name,
    description: await readIncidentDescription(context, row),
    errorIds: parsedArray(row.error_ids, isText),
    breadcrumbs: parsedArray(row.breadcrumbs, isCrumb),
    route: reportContext.route,
    appVersion: reportContext.appVersion,
    deployment: reportContext.deployment,
    hasScreenshot: row.screenshot_key !== null,
  };
}
