/*
 * The Recent Errors tab's read, from the control plane's own error record first.
 *
 * Every problem the API answers and every crash the app reports is kept in `error_record` for thirty
 * days (src/http/error-record.ts, src/http/routes/platform/client-errors.ts), so the tab no longer
 * waits on a Workers Logs token to show a member's failure. What the record cannot hold is a failure
 * nobody was shown — a sweep, a queue consumer, a Cron pass — which only Workers Logs has; where a
 * log-read token is set, those background failures are read from there (./recent-errors.ts) and
 * joined on. The request failures Workers Logs also holds are left out of that read, because the
 * record already has each of them.
 */
import {
  selectErrorRecordGroupsStatement,
  type ErrorRecordGroupRow,
} from "@magna-carta/data-access/error-record-statements";
import type { Bindings } from "../bindings.ts";
import {
  readRecentErrors,
  RECENT_ERROR_WINDOW_MILLISECONDS,
  type RecentErrorGroup,
} from "./recent-errors.ts";

/** The most kinds of failure one read returns. */
export const RECORDED_ERROR_GROUP_LIMIT = 200;

export type RecordedErrorSource = "server" | "browser" | "background";

export interface RecordedErrorGroup {
  readonly source: RecordedErrorSource;
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

export type BackgroundLogState = "read" | "not-configured" | "refused" | "unreachable";

export type RecordedErrorsReport =
  | { readonly state: "unreachable"; readonly backgroundState: BackgroundLogState }
  | {
      readonly state: "read";
      readonly backgroundState: BackgroundLogState;
      readonly windowStart: string;
      readonly windowEnd: string;
      readonly total: number;
      readonly truncated: boolean;
      readonly groups: readonly RecordedErrorGroup[];
    };

function fromRow(row: ErrorRecordGroupRow): RecordedErrorGroup {
  return {
    source: row.source === "browser" ? "browser" : "server",
    latestErrorId: row.latest_error_id,
    service: row.service,
    where: row.operation,
    status: row.status,
    title: row.title,
    errorName: row.error_name,
    messageHead: row.message_head,
    count: Number(row.count),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}

function fromLogGroup(group: RecentErrorGroup): RecordedErrorGroup {
  return {
    source: "background",
    latestErrorId: group.latestErrorId,
    service: group.service,
    where: group.where,
    status: null,
    title: null,
    errorName: group.errorName,
    messageHead: group.messageHead,
    count: group.count,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
  };
}

export async function readRecordedErrors(
  env: Pick<Bindings, "DB_CONTROL" | "CLOUDFLARE_ACCOUNT_ID" | "OBSERVABILITY_API_TOKEN">,
  options: { readonly now?: number; readonly fetchImplementation?: typeof fetch } = {},
): Promise<RecordedErrorsReport> {
  const now = options.now ?? Date.now();
  const windowStart = new Date(now - RECENT_ERROR_WINDOW_MILLISECONDS).toISOString();

  const logs = await readRecentErrors(env, options);
  const backgroundState: BackgroundLogState = logs.state;
  const background =
    logs.state === "read"
      ? logs.groups.filter((group) => group.eventName === "operation.failed").map(fromLogGroup)
      : [];

  let rows: ErrorRecordGroupRow[];
  try {
    ({ results: rows } = await selectErrorRecordGroupsStatement(
      env.DB_CONTROL,
      windowStart,
      RECORDED_ERROR_GROUP_LIMIT,
    ).all<ErrorRecordGroupRow>());
  } catch {
    return { state: "unreachable", backgroundState };
  }

  const groups = [...rows.map(fromRow), ...background].sort((left, right) =>
    right.lastSeen.localeCompare(left.lastSeen),
  );
  return {
    state: "read",
    backgroundState,
    windowStart,
    windowEnd: new Date(now).toISOString(),
    total: groups.reduce((sum, group) => sum + group.count, 0),
    truncated:
      rows.length >= RECORDED_ERROR_GROUP_LIMIT || (logs.state === "read" && logs.truncated),
    groups,
  };
}
