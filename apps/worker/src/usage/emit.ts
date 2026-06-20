import { usageFeature } from "@magna-carta/telemetry/events";
import type { Logger } from "@magna-carta/telemetry/logger";
import { pseudonymize } from "@magna-carta/telemetry/pseudonymize";
import type { FeatureKey } from "@magna-carta/telemetry/usage-features";

export interface EmitUsageParams {
  readonly logger: Logger;
  readonly consented: boolean;
  readonly pepper: string | undefined;
  readonly correlationId: string;
  readonly now: string;
  readonly feature: FeatureKey;
  readonly phase: "reached" | "completed";
  readonly surface: "web" | "desktop" | "portal" | null;
  readonly appVersion: string | null;
  readonly firmId: string;
  readonly userId: string | null;
}

// The single usage emit point: consent gate, fail-closed hashing, then both sinks (the full-fidelity
// log row that flows to Iceberg, and the aggregate Analytics Engine counter). The firm id is always
// hashed; a missing pepper suppresses the event entirely (never emit a raw or unhashed id).
export async function emitUsage(params: EmitUsageParams): Promise<void> {
  if (!params.consented) return;
  const firmIdHash = await pseudonymize(params.pepper, params.firmId);
  if (firmIdHash === null) return; // fail-closed: no pepper, no event
  const userIdHash =
    params.userId === null ? null : await pseudonymize(params.pepper, params.userId);

  params.logger.log(
    usageFeature(
      { correlationId: params.correlationId, now: params.now },
      {
        feature: params.feature,
        phase: params.phase,
        surface: params.surface,
        firmIdHash,
        userIdHash,
        appVersion: params.appVersion,
      },
    ),
  );
  // count() dimensions are strings only — the aggregate, hash-free counter (feature x phase x
  // surface, all bounded low-cardinality). null surface becomes the literal "none".
  params.logger.count("usage", {
    feature: params.feature,
    phase: params.phase,
    surface: params.surface ?? "none",
  });
}
