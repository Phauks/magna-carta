/*
 * The Recent Errors tab's words and its reads: GET /api/v1/platform/recent-errors, a platform
 * operator's view of the deployment's failures over the last day, one row per kind of failure, and
 * GET /api/v1/platform/errors/{errorId}, what one Error ID was. Requests and browser crashes come
 * from the control plane's own error record; background failures come from Workers Logs where a
 * log-read token is set (apps/api-worker/src/system-status/recorded-errors.ts). This file says what
 * each outcome means to a reader. Pure apart from the fetch helpers, so the words are testable
 * without a browser.
 */
import { platformErrorLookup, platformRecentErrors } from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type RecentErrorsState = "read" | "unreachable";
export type BackgroundErrorsState = "read" | "not-configured" | "refused" | "unreachable";
export type RecentErrorSource = "server" | "browser" | "background";

export interface RecentErrorGroup {
  readonly source: RecentErrorSource;
  readonly latestErrorId: string | null;
  readonly service: string | null;
  readonly where: string | null;
  readonly status: number | null;
  readonly title: string | null;
  readonly errorName: string | null;
  readonly messageHead: string | null;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface RecentErrorsValue {
  readonly state: RecentErrorsState;
  readonly backgroundState: BackgroundErrorsState;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly total: number | null;
  readonly truncated: boolean;
  readonly groups: readonly RecentErrorGroup[];
}

/** The tab's label. */
export const RECENT_ERRORS_SECTION_LABEL = "Recent Errors";

export async function readRecentErrors(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<RecentErrorsValue>> {
  try {
    const { data } = await platformRecentErrors({ fetch: fetchImpl, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Why there are no rows, when the read could not be made. Null when it was. */
export function describeRecentErrorsState(state: RecentErrorsState): string | null {
  return state === "read" ? null : "The error record could not be read. Try again shortly.";
}

/**
 * What is missing when background failures (sweeps, queue consumers, Cron passes) could not be read
 * from Workers Logs. Null when they were. Requests and browser crashes are shown either way.
 */
export function describeBackgroundState(state: BackgroundErrorsState): string | null {
  switch (state) {
    case "read":
      return null;
    case "not-configured":
      return "Background failures are not shown: Workers Logs needs a read-only token first.";
    case "refused":
      return "Background failures are not shown: Cloudflare did not accept the log-read token.";
    case "unreachable":
      return "Background failures are not shown: Workers Logs did not answer in time.";
  }
}

/** Where the failure happened: an operation, the app route a crash was under, or a pass's name. */
export function describeErrorPlace(group: RecentErrorGroup): string {
  return (
    group.where ??
    (group.source === "background"
      ? "a background pass"
      : group.source === "browser"
        ? "the app"
        : "a request")
  );
}

/** "Request", "Browser" or "Background": where the failure was caught. */
export function errorKindLabel(source: RecentErrorSource): string {
  return source === "browser" ? "Browser" : source === "background" ? "Background" : "Request";
}

/** What failed, in a few words: the error kind on a fault or crash, the answer on a refusal. */
export function describeErrorWhat(group: RecentErrorGroup): string {
  if (group.errorName !== null) return group.errorName;
  if (group.status !== null) {
    return group.title === null ? String(group.status) : `${String(group.status)} ${group.title}`;
  }
  return "Error";
}

/** One recorded failure, as the lookup returns it. */
export interface ErrorRecordValue {
  readonly errorId: string;
  readonly recordedAt: string;
  readonly source: "server" | "browser";
  readonly service: string | null;
  readonly operation: string | null;
  readonly status: number | null;
  readonly problemType: string | null;
  readonly title: string | null;
  readonly errorName: string | null;
  readonly messageHead: string | null;
  readonly location: string | null;
  readonly build: string | null;
  readonly firmId: string | null;
  readonly userId: string | null;
  readonly correlationId: string | null;
}

export interface ErrorLookupValue {
  readonly record: ErrorRecordValue | null;
  readonly mintedAt: string | null;
  readonly mintedBy: string | null;
}

/** The shape an Error ID has: a server's error_… or the app's client_…. */
export const ERROR_ID_SHAPE = /^(error|client)_[A-Za-z0-9]+$/;

export async function lookupErrorId(
  fetchImpl: typeof fetch,
  errorId: string,
): Promise<ApiOutcome<ErrorLookupValue>> {
  try {
    const { data } = await platformErrorLookup({
      fetch: fetchImpl,
      throwOnError: true,
      path: { errorId },
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** The facts a found record shows, as label and value rows. */
export function errorRecordRows(
  record: ErrorRecordValue,
): { label: string; value: string; mono?: boolean }[] {
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  const add = (label: string, value: string | null, mono = false) => {
    if (value !== null && value !== "") rows.push({ label, value, mono });
  };
  add(record.source === "browser" ? "App route" : "Request", record.operation, true);
  add(
    "Answer",
    record.status === null
      ? null
      : record.title === null
        ? String(record.status)
        : `${String(record.status)} ${record.title}`,
  );
  add("Problem type", record.problemType, true);
  add(
    "Cause",
    record.errorName === null
      ? null
      : record.messageHead === null
        ? record.errorName
        : `${record.errorName}: ${record.messageHead}`,
    true,
  );
  add("Where", record.location, true);
  add("Build", record.build, true);
  add("Service", record.service, true);
  add("Firm", record.firmId, true);
  add("Member", record.userId, true);
  add("Correlation ID", record.correlationId, true);
  return rows;
}

/** What to say when an ID has no record. */
export function describeMissingRecord(value: ErrorLookupValue): string {
  if (value.mintedAt === null) {
    return "No record of this ID. A browser crash is kept only when the member was signed in, and records are kept for 30 days.";
  }
  return `No record of this ID. It was made by the ${value.mintedBy ?? "unknown"} service at ${value.mintedAt}. Failures before recording began (November 14, 2026), signed-out and rate-limit answers, and anything older than 30 days are not kept; Workers Logs may still have it.`;
}

/** The tile's number and its line beneath. */
export function recentErrorsTile(value: RecentErrorsValue | null): {
  figure: string;
  detail: string;
} {
  if (value === null) return { figure: "—", detail: "Reading" };
  if (value.state !== "read") return { figure: "—", detail: "Not available" };
  const total = value.total ?? 0;
  const kinds = value.groups.length;
  return {
    figure: `${String(total)}${value.truncated ? "+" : ""}`,
    detail: kinds === 0 ? "None in 24 hours" : `${String(kinds)} kind${kinds === 1 ? "" : "s"}`,
  };
}
