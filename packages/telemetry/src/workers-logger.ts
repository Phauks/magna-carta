// The Workers Logger adapter — THE one legal console.* call site (the console-ban fitness function
// in test/console-ban.test.ts allow-lists exactly this file). It scrubs every event on the way out
// (scrub.ts backstop),
// emits one structured-JSON line (Workers Logs captures it), counts scrub trips, and mirrors
// counters to an Analytics Engine dataset binding. AE writes are fire-and-forget: writeDataPoint is
// sync and non-blocking, never awaited, and a missing binding degrades silently.
//
// Both emission paths carry the same posture. Events are allowlisted by their builder and scrubbed
// here; counters are allowlisted by the metric catalog (metrics.ts) and their dimension values are
// scrubbed here too. Before the catalog, count() was an unguarded door into the dataset — any metric
// name, any dimension value, no allowlist, no scrub, no tripwire — which made it the cheapest way to
// get privileged content into Analytics Engine, and the one no test would have caught.
import { UNLOGGABLE_VALUE, type TelemetryEvent } from "./event.ts";
import type { Logger } from "./logger.ts";
import {
  metricDefinition,
  scrubbedDimension,
  scrubbedField,
  undeclaredMetric,
  unloggableField,
} from "./metrics.ts";
import { scrubStrings, scrubText } from "./scrub.ts";

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
  // `raiseTripwires` is false for the tripwire counters themselves. A tripwire is emitted from
  // inside this function, so without the flag a tripwire whose own dimension tripped would emit
  // another tripwire, and so on — an unbounded recursion on the emission path. One level is all the
  // signal there is to carry anyway: the tripwire names the metric that misbehaved.
  const write = (
    metric: string,
    dimensions: Record<string, string>,
    value: number,
    raiseTripwires: boolean,
  ): void => {
    if (analyticsEngine === undefined) return; // no binding (dev/test) — never throw, never compute

    const definition = metricDefinition(metric);
    if (definition === undefined) {
      // An undeclared metric has no column contract, so there is no safe layout for its dimensions
      // and no basis for treating any of them as a label rather than content. Drop the point and
      // make the omission itself visible; declaring the metric in metrics.ts is the fix.
      if (raiseTripwires) {
        write(undeclaredMetric.metricName, { metric, dimension: "" }, 1, false);
      }
      return;
    }

    // Blobs are laid out from the DECLARED key order, not from the caller's object. A declared
    // dimension the caller omitted holds an empty string so every row of a metric has the same
    // width and the column meanings stay fixed.
    const blobs: string[] = [metric];
    for (const key of definition.dimensionKeys) {
      const supplied = dimensions[key];
      if (supplied === undefined) {
        blobs.push("");
        continue;
      }
      const { text, tripped } = scrubText(supplied);
      if (tripped && raiseTripwires) {
        write(scrubbedDimension.metricName, { metric, dimension: key }, 1, false);
      }
      blobs.push(text);
    }

    if (raiseTripwires) {
      for (const key of Object.keys(dimensions)) {
        if (!definition.dimensionKeys.includes(key)) {
          write(undeclaredMetric.metricName, { metric, dimension: key }, 1, false);
        }
      }
    }

    // Fire-and-forget; the absent-binding case returned above (dev/test degrade to no AE).
    analyticsEngine.writeDataPoint({ blobs, doubles: [value], indexes: [metric] });
  };

  const count: Logger["count"] = (metric, dimensions = {}, value = 1) => {
    write(metric, dimensions, value, true);
  };

  const log: Logger["log"] = (event: TelemetryEvent) => {
    const { event: scrubbed, trips } = scrubStrings(event);
    emit(JSON.stringify(scrubbed));
    for (const trip of trips) {
      count(scrubbedField.metricName, { eventName: scrubbed.name, field: trip.field });
    }
    // A field the builder had to replace because it was handed a structure rather than a primitive.
    // The replacement already happened upstream (event.ts); this is where it becomes visible, on the
    // same aggregatable footing as a scrub trip.
    for (const [field, value] of Object.entries(scrubbed.fields)) {
      if (value === UNLOGGABLE_VALUE) {
        count(unloggableField.metricName, { eventName: scrubbed.name, field });
      }
    }
  };

  return { log, count };
}
