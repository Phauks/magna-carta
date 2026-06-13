// The Workers Logger adapter — THE one legal console.* call site (the console-ban fitness function,
// Task 7, allow-lists exactly this file). It scrubs every event on the way out (scrub.ts backstop),
// emits one structured-JSON line (Workers Logs captures it), counts scrub trips, and mirrors
// counters to an Analytics Engine dataset binding. AE writes are fire-and-forget (decided #5):
// writeDataPoint is sync and non-blocking, never awaited, and a missing binding degrades silently.
import type { TelemetryEvent } from "./event.ts";
import type { Logger } from "./logger.ts";
import { scrubStrings } from "./scrub.ts";

// Minimal structural type for the Analytics Engine binding. Defined locally so this otherwise-pure
// package needs no @cloudflare/workers-types dependency; the Worker's real env.TELEMETRY binding is
// structurally compatible.
export interface AnalyticsEngineDataset {
  writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

// The line sink — defaults to the real console (keeping the one fitness-allowed console.* literal in
// this file); tests inject a spy to assert on the emitted line.
export type EmitLine = (line: string) => void;
const consoleEmit: EmitLine = (line) => {
  console.log(line);
};

export function createWorkersLogger(
  analyticsEngine?: AnalyticsEngineDataset,
  emit: EmitLine = consoleEmit,
): Logger {
  const count: Logger["count"] = (metric, dimensions = {}, value = 1) => {
    // Fire-and-forget; absent binding is a no-op (dev/test degrade to no AE, never throw).
    analyticsEngine?.writeDataPoint({
      blobs: [metric, ...Object.values(dimensions)],
      doubles: [value],
      indexes: [metric],
    });
  };

  const log: Logger["log"] = (event: TelemetryEvent) => {
    const { event: scrubbed, trips } = scrubStrings(event);
    emit(JSON.stringify(scrubbed));
    for (const trip of trips) {
      count("telemetry.scrubbed", { eventName: scrubbed.name, field: trip.field });
    }
  };

  return { log, count };
}
