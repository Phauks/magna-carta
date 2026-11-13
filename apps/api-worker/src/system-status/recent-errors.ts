/*
 * The deployment's recent errors, read back from Workers Logs for the System Status page.
 *
 * Errors are not stored anywhere this Worker can query: the standard logging path writes one JSON
 * line per event to Workers Logs (packages/telemetry/src/workers-logger.ts) and nothing else. So
 * this asks Cloudflare's Workers Logs query API for the two failure events the pipeline emits —
 * `error.captured` (an exception that escaped a request) and `operation.failed` (a caught failure
 * in a sweep, a consumer or another background pass) — across every Worker on the account, over
 * the last day, and folds them into one row per kind of failure.
 *
 * What a row carries is what the log line already carries, and the log line is redacted by
 * construction: an event's fields are an allowlist with no slot for content, and `messageHead` is
 * scrubbed on the way out. Nothing here widens that; it reads back what was already written.
 *
 * Four outcomes, never a throw: `not-configured` (no account id or no read token), `refused` (the
 * API did not accept the token), `unreachable` (no answer in time, or a fault), and `read`.
 */
import type { Bindings } from "../bindings.ts";

const QUERY_URL = (accountId: string): string =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/observability/telemetry/query`;

/** The window the page reports on. */
export const RECENT_ERROR_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1000;
/** How many events one read asks for. A day busier than this says so (`truncated`). */
export const RECENT_ERROR_EVENT_LIMIT = 500;
const QUERY_TIMEOUT_MILLISECONDS = 5000;

const FAILURE_EVENT_NAMES = ["error.captured", "operation.failed"] as const;

export interface RecentErrorGroup {
  /** The newest Error ID in the group: the one to search the logs for. */
  readonly latestErrorId: string | null;
  /** The Worker that logged it. */
  readonly service: string | null;
  /** `error.captured` or `operation.failed`. */
  readonly eventName: string;
  /** The route template (a request) or the operation label (a background pass). */
  readonly where: string | null;
  readonly errorName: string | null;
  /** The scrubbed first slice of the message, as the log line carries it. */
  readonly messageHead: string | null;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export type RecentErrorsReport =
  | { readonly state: "not-configured" | "refused" | "unreachable" }
  | {
      readonly state: "read";
      readonly windowStart: string;
      readonly windowEnd: string;
      readonly total: number;
      readonly truncated: boolean;
      readonly groups: readonly RecentErrorGroup[];
    };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/*
 * One event as Workers Logs hands it back. `source` is the JSON line the logger wrote, parsed; the
 * Worker's name is in the event's own metadata, or in the Workers enrichment block, depending on
 * how the dataset recorded it.
 */
function readEvent(event: unknown): {
  service: string | null;
  eventName: string;
  where: string | null;
  errorName: string | null;
  messageHead: string | null;
  errorId: string | null;
  timestamp: number;
} | null {
  if (!isRecord(event)) return null;
  const source = isRecord(event.source) ? event.source : null;
  if (source === null) return null;
  const eventName = text(source.name);
  if (eventName === null || !(FAILURE_EVENT_NAMES as readonly string[]).includes(eventName)) {
    return null;
  }
  const fields = isRecord(source.fields) ? source.fields : {};
  const metadata = isRecord(event.$metadata) ? event.$metadata : {};
  const workers = isRecord(event.$workers) ? event.$workers : {};
  const timestamp = typeof event.timestamp === "number" ? event.timestamp : NaN;
  if (!Number.isFinite(timestamp)) return null;
  const route = text(fields.route);
  const method = text(fields.method);
  return {
    service: text(metadata.service) ?? text(workers.scriptName),
    eventName,
    where:
      route !== null ? (method !== null ? `${method} ${route}` : route) : text(fields.operation),
    errorName: text(fields.errorName),
    messageHead: text(fields.messageHead),
    errorId: text(fields.errorId),
    timestamp,
  };
}

/** Fold events into one row per kind of failure, newest first. Exported for the tests. */
export function groupRecentErrors(events: readonly unknown[]): RecentErrorGroup[] {
  const groups = new Map<string, RecentErrorGroup & { lastSeenEpoch: number }>();
  for (const raw of events) {
    const event = readEvent(raw);
    if (event === null) continue;
    const key = [event.service, event.eventName, event.where, event.errorName].join("\u0000");
    const seen = new Date(event.timestamp).toISOString();
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        latestErrorId: event.errorId,
        service: event.service,
        eventName: event.eventName,
        where: event.where,
        errorName: event.errorName,
        messageHead: event.messageHead,
        count: 1,
        firstSeen: seen,
        lastSeen: seen,
        lastSeenEpoch: event.timestamp,
      });
      continue;
    }
    const newer = event.timestamp > existing.lastSeenEpoch;
    groups.set(key, {
      ...existing,
      count: existing.count + 1,
      latestErrorId: newer ? (event.errorId ?? existing.latestErrorId) : existing.latestErrorId,
      messageHead: newer ? (event.messageHead ?? existing.messageHead) : existing.messageHead,
      firstSeen: seen < existing.firstSeen ? seen : existing.firstSeen,
      lastSeen: newer ? seen : existing.lastSeen,
      lastSeenEpoch: newer ? event.timestamp : existing.lastSeenEpoch,
    });
  }
  return [...groups.values()]
    .sort((left, right) => right.lastSeenEpoch - left.lastSeenEpoch)
    .map(({ lastSeenEpoch: _lastSeenEpoch, ...group }) => group);
}

export async function readRecentErrors(
  env: Pick<Bindings, "CLOUDFLARE_ACCOUNT_ID" | "OBSERVABILITY_API_TOKEN">,
  options: { readonly now?: number; readonly fetchImplementation?: typeof fetch } = {},
): Promise<RecentErrorsReport> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.OBSERVABILITY_API_TOKEN?.trim();
  if (accountId === undefined || accountId === "" || token === undefined || token === "") {
    return { state: "not-configured" };
  }
  const now = options.now ?? Date.now();
  const from = now - RECENT_ERROR_WINDOW_MILLISECONDS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(QUERY_URL(accountId), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        queryId: "system-status-recent-errors",
        timeframe: { from, to: now },
        view: "events",
        limit: RECENT_ERROR_EVENT_LIMIT,
        parameters: {
          filters: FAILURE_EVENT_NAMES.map((name) => ({
            key: "name",
            operation: "eq",
            type: "string",
            value: name,
          })),
          filterCombination: "or",
        },
      }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MILLISECONDS),
    });
  } catch {
    return { state: "unreachable" };
  }
  if (response.status === 401 || response.status === 403) return { state: "refused" };
  if (!response.ok) return { state: "unreachable" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "unreachable" };
  }
  const result = isRecord(body) && isRecord(body.result) ? body.result : null;
  const eventsBlock = result !== null && isRecord(result.events) ? result.events : null;
  const events =
    eventsBlock !== null && Array.isArray(eventsBlock.events) ? eventsBlock.events : [];
  const groups = groupRecentErrors(events);
  return {
    state: "read",
    windowStart: new Date(from).toISOString(),
    windowEnd: new Date(now).toISOString(),
    total: groups.reduce((sum, group) => sum + group.count, 0),
    truncated: events.length >= RECENT_ERROR_EVENT_LIMIT,
    groups,
  };
}
