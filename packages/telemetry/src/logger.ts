// The Logger seam (spec §1). The interface is pure — log(event) emits a structured event; count()
// records a metric. The Workers adapter (workers-logger.ts) is the production implementation and the
// ONLY legal console.* site; this module is the interface plus the in-memory test adapter.
import type { TelemetryEvent } from "./event.ts";

export interface Logger {
  log(event: TelemetryEvent): void;
  // Metric dimensions are flat string labels (Analytics Engine blobs). value defaults to 1.
  count(metric: string, dimensions?: Record<string, string>, value?: number): void;
}

export interface RecordedCount {
  readonly metric: string;
  readonly dimensions: Record<string, string>;
  readonly value: number;
}

export interface MemoryLogger extends Logger {
  readonly events: TelemetryEvent[];
  readonly counts: RecordedCount[];
}

// Records everything in memory for assertions — no scrubbing (tests inspect raw events) and no I/O.
export function createMemoryLogger(): MemoryLogger {
  const events: TelemetryEvent[] = [];
  const counts: RecordedCount[] = [];
  return {
    events,
    counts,
    log(event) {
      events.push(event);
    },
    count(metric, dimensions = {}, value = 1) {
      counts.push({ metric, dimensions, value });
    },
  };
}
