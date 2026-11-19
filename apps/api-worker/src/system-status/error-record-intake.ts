/*
 * Where another Worker hands a failure it logged, so the failure lands in this Worker's error record.
 *
 * Only this Worker holds the control-plane database. A Worker that does not (the document editor's,
 * which fronts untrusted documents and is kept away from storage on purpose) still logs failures
 * that somebody may quote an Error ID from, and without a record those IDs could only be read back
 * from Workers Logs with an account token. So such a Worker installs the telemetry failed-operation
 * tap and hands each failure here over a service binding naming this entrypoint.
 *
 * A named entrypoint is reached only through a service binding another Worker on the account
 * declares; it has no public route. Even so, everything arriving here is checked as if it were
 * untrusted: the Error ID must be one, the Worker code must be one, every text is cut to the length
 * the record keeps, and the event must be one of the two failure events. A row is written exactly as
 * this Worker's own tap would write it (`errorRecordFromFailureEvent`).
 *
 * The imports a call needs are dynamic, for the reason src/index.ts gives: this class is exported
 * from the entrypoint, so anything it imports statically is evaluated against the startup budget.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Bindings } from "../bindings.ts";

/** A Worker's three-letter code, as its Error IDs carry it (`setServiceIdentity`). */
const SERVICE_CODE_PATTERN = /^[a-z]{3}$/;

/** The longest text kept from a handed-over event; the record's message head is shorter still. */
const LONGEST_TEXT = 300;

function boundedText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value.slice(0, LONGEST_TEXT) : null;
}

/** The handed-over event, rebuilt from only the fields a record reads. Null where it is not one. */
export function handedOverFailureEvent(event: unknown): {
  name: string;
  at: string;
  correlationId: string;
  fields: Record<string, string | null>;
} | null {
  if (typeof event !== "object" || event === null) return null;
  const candidate = event as Record<string, unknown>;
  const name = candidate.name;
  if (name !== "operation.failed" && name !== "error.captured") return null;
  const fields =
    typeof candidate.fields === "object" && candidate.fields !== null
      ? (candidate.fields as Record<string, unknown>)
      : {};
  return {
    name,
    at: boundedText(candidate.at) ?? "",
    correlationId: boundedText(candidate.correlationId) ?? "",
    fields: {
      errorId: boundedText(fields.errorId),
      operation: boundedText(fields.operation),
      route: boundedText(fields.route),
      errorName: boundedText(fields.errorName),
      messageHead: boundedText(fields.messageHead),
    },
  };
}

export class ErrorRecordIntake extends WorkerEntrypoint<Bindings> {
  /** Record one failure another Worker logged. Never throws: the caller's log line already stands. */
  async record(event: unknown, service: unknown): Promise<void> {
    try {
      if (typeof service !== "string" || !SERVICE_CODE_PATTERN.test(service)) return;
      const rebuilt = handedOverFailureEvent(event);
      if (rebuilt === null) return;
      const [{ identifierPattern }, { errorRecordFromFailureEvent, insertErrorRecordStatement }] =
        await Promise.all([
          import("@magna-carta/identifiers/validate"),
          import("@magna-carta/data-access/error-record-statements"),
        ]);
      const errorId = rebuilt.fields.errorId;
      if (errorId === null || errorId === undefined || !identifierPattern("error").test(errorId))
        return;
      const recordedAt = Number.isNaN(Date.parse(rebuilt.at))
        ? new Date().toISOString()
        : rebuilt.at;
      const row = errorRecordFromFailureEvent({ ...rebuilt, at: recordedAt }, service);
      if (row === null) return;
      await insertErrorRecordStatement(this.env.DB_CONTROL, row).run();
    } catch {
      // Swallowed without logging: a logged failure here would be a failure of the record itself,
      // and the failure being handed over is already in the calling Worker's Workers Logs.
    }
  }
}
