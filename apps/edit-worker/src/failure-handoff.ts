// Handing this worker's failures to the app worker's error record.
//
// This worker answers a throw with a 500 carrying an Error ID and logs it (diagnostics.ts), and it
// holds no database by design: it fronts untrusted documents and never reaches storage. Without a
// record, an Error ID quoted from the editor could only be read back from Workers Logs with an
// account token. So each failure the Workers logger emits is also handed, through the telemetry
// package's failed-operation tap, to the app worker's `ErrorRecordIntake` entrypoint over the
// `ERROR_RECORD` service binding, which writes it to the record the app's System Status reads.
//
// The event handed over is the one already scrubbed and written to Workers Logs, so the record can
// hold nothing the log line does not. The hand-off rides `waitUntil`, never the response, and a
// failure of it is swallowed without logging: logged, it would be handed straight back here.
//
// Pure: imports nothing from `cloudflare:workers`, so the node test pool runs it against fakes.
import type { TelemetryEvent } from "@magna-carta/telemetry/event";
import { setFailedOperationTap } from "@magna-carta/telemetry/failed-operation-tap";
import { serviceIdentity } from "@magna-carta/telemetry/service-identity";

/** The app worker's named entrypoint, as the service binding exposes it. */
export interface ErrorRecordIntake {
  record(event: TelemetryEvent, service: string): Promise<void>;
}

/**
 * Hand each failure logged from here on to `intake`, kept alive by `waitUntil`. Installed per
 * request because `waitUntil` belongs to one request; an isolate serves one request's failures at a
 * time through the latest installation, which is the request that logged them. With no binding (the
 * local pool, a deployment without it) the tap is removed and failures stay in Workers Logs only.
 */
export function handFailuresTo(
  intake: ErrorRecordIntake | undefined,
  waitUntil: (work: Promise<unknown>) => void,
): void {
  if (intake === undefined) {
    setFailedOperationTap(null);
    return;
  }
  setFailedOperationTap((event) => {
    waitUntil(
      intake.record(event, serviceIdentity()).catch(() => {
        // Nothing to do: the line is in Workers Logs.
      }),
    );
  });
}
