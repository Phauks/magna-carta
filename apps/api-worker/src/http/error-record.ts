/*
 * Keeping each problem this Worker answers against its Error ID, so the ID a member reads off their
 * screen can be looked up afterwards (System Status, Recent Errors) rather than only searched for in
 * Workers Logs by someone holding a log-read token.
 *
 * What is kept is what the problem reply and the log line already carry: the route TEMPLATE and
 * method, the status, the registered problem type and its title, and — on a fault — the exception's
 * name and its scrubbed message head. The firm and member are ids. Nothing a member typed reaches it.
 *
 * Two answers are not kept. A signed-out answer (401) and a rate-limit answer (429) arrive in floods
 * from pages left open and from throttled clients, say nothing about a fault, and would crowd every
 * real failure out of the table.
 */
import type { Context } from "hono";
import { insertErrorRecordStatement } from "@magna-carta/data-access/error-record-statements";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { serviceIdentity } from "@magna-carta/telemetry/service-identity";
import type { Bindings } from "../bindings.ts";
import type { AppVariables } from "./chokepoint/ports.ts";
import { runInBackground } from "./deferred-work.ts";

const UNRECORDED_STATUSES: ReadonlySet<number> = new Set([401, 429]);

type RecordingContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

/** Record the problem this request answered, if it answered one worth keeping. Never throws. */
export function recordAnsweredProblem(c: RecordingContext): void {
  const answered = c.get("answeredProblem");
  if (answered === undefined) return;
  // A handler can build a problem and then answer something else; only the one that went out counts.
  if (c.res.status !== answered.status) return;
  if (UNRECORDED_STATUSES.has(answered.status)) return;
  const database = c.env.DB_CONTROL as Bindings["DB_CONTROL"] | undefined;
  if (database === undefined) return;

  const firmId = (c.get("chokepointFirmId") as string | undefined) ?? null;
  const userId =
    (c.get("chokepointUserId") as string | undefined) ??
    (c.get("platformOperatorUserId") as string | undefined) ??
    null;
  const correlationId = c.get("correlationId") ?? null;

  const write = insertErrorRecordStatement(database, {
    errorId: answered.errorId,
    recordedAt: new Date().toISOString(),
    source: "server",
    service: serviceIdentity(),
    operation: answered.operation,
    status: answered.status,
    problemType: answered.type,
    title: answered.title,
    errorName: answered.errorName,
    messageHead: answered.messageHead,
    location: null,
    build: null,
    firmId,
    userId,
    correlationId,
  })
    .run()
    .catch((caught: unknown) => {
      const logger = c.get("logger");
      if (logger !== undefined) {
        logOperationFailed(logger, "error-record:write", caught, correlationId ?? undefined);
      }
    });
  runInBackground(c, write);
}
