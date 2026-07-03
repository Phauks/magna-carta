import type { ComponentStatus } from "./vocabulary.ts";
import type { DerivedComponent } from "./schema.ts";
import { COMPONENT_REGISTRY } from "./component-registry.ts";

export interface ProbeOutcome {
  ok: boolean;
}
export interface TelemetrySignal {
  errorRatePerMinute: number;
  sampleCount: number;
}

export interface DeriveInput {
  now: string;
  // core-probe components, by component id
  probes: Record<string, ProbeOutcome>;
  // engine components, by component id (absent or sampleCount 0 => idle => operational)
  signals: Record<string, TelemetrySignal>;
  degradedThreshold: number;
  outageThreshold: number;
}

// The default resting state is operational; a component leaves it only on positive evidence.
export function deriveComponents(input: DeriveInput): DerivedComponent[] {
  return COMPONENT_REGISTRY.map((def) => {
    if (def.kind === "core-probe") {
      const probe = input.probes[def.id];
      const status: ComponentStatus = probe && !probe.ok ? "major_outage" : "operational";
      return {
        id: def.id,
        name: def.name,
        group: def.group,
        status,
        source: "probe",
        lastChange: input.now,
      };
    }
    const signal = input.signals[def.id];
    let status: ComponentStatus = "operational";
    if (signal && signal.sampleCount > 0) {
      if (signal.errorRatePerMinute >= input.outageThreshold) status = "partial_outage";
      else if (signal.errorRatePerMinute >= input.degradedThreshold) status = "degraded";
    }
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      status,
      source: "telemetry",
      lastChange: input.now,
    };
  });
}
