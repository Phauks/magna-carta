/*
 * The Recent Errors tab's read, from the control plane's own error record first.
 *
 * Every problem the API answers and every crash the app reports is kept in `error_record` for thirty
 * days (src/http/error-record.ts, src/http/routes/platform/client-errors.ts), and so is every
 * failure nobody was shown — a sweep, a queue consumer, a Cron pass — through the failed-operation tap
 * (./background-error-record.ts), so the tab needs no Workers Logs token. Where a log-read token IS
 * set, Workers Logs adds what the record could not take: a failure from before the tap existed, or
 * one whose write failed. The editor and forum Workers record their own failures too
 * (./error-record-intake.ts, apps/community-worker/src/failure-record.ts); the other Workers log
 * none of their own, because the API Worker that calls them logs the failure. A log group whose newest Error ID the record already holds
 * is left out of that read, so a failure is counted once.
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
    source: row.source === "browser" || row.source === "background" ? row.source : "server",
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

  const recorded = new Set(rows.map((row) => row.latest_error_id));
  const unrecorded = background.filter(
    (group) => group.latestErrorId === null || !recorded.has(group.latestErrorId),
  );
  const groups = [...rows.map(fromRow), ...unrecorded].sort((left, right) =>
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
