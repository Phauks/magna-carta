/*
 * The Recent Errors tab's words and its read: GET /api/v1/platform/recent-errors, a platform
 * operator's view of the deployment's failures over the last day, one row per kind of failure. The
 * API folds the Workers Logs events (apps/api-worker/src/system-status/recent-errors.ts); this file
 * says what each outcome means to a reader. Pure apart from the one fetch helper, so the words are
 * testable without a browser.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

export type RecentErrorsState = "read" | "not-configured" | "refused" | "unreachable";

export interface RecentErrorGroup {
  readonly latestErrorId: string | null;
  readonly service: string | null;
  readonly eventName: string;
  readonly where: string | null;
  readonly errorName: string | null;
  readonly messageHead: string | null;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface RecentErrorsValue {
  readonly state: RecentErrorsState;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly total: number | null;
  readonly truncated: boolean;
  readonly groups: readonly RecentErrorGroup[];
}

/** The tab's label. */
export const RECENT_ERRORS_SECTION_LABEL = "Recent Errors";

export function readRecentErrors(fetchImpl: typeof fetch): Promise<ApiOutcome<RecentErrorsValue>> {
  return requestJson<RecentErrorsValue>(fetchImpl, "/api/v1/platform/recent-errors");
}

/** Why there are no rows, when the read could not be made. Null when it was. */
export function describeRecentErrorsState(state: RecentErrorsState): string | null {
  switch (state) {
    case "read":
      return null;
    case "not-configured":
      return "Not set up. Workers Logs needs a read-only token before errors can be shown here.";
    case "refused":
      return "Cloudflare did not accept the log-read token. Check that it can read Workers Observability.";
    case "unreachable":
      return "Workers Logs did not answer in time.";
  }
}

/** Where the failure happened: a request's route, or a background pass's name. */
export function describeErrorPlace(group: RecentErrorGroup): string {
  return group.where ?? (group.eventName === "operation.failed" ? "a background pass" : "a request");
}

/** "Request" or "Background", the two kinds of failure the pipeline logs. */
export function errorKindLabel(eventName: string): string {
  return eventName === "operation.failed" ? "Background" : "Request";
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
