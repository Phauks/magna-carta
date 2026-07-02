import type { Logger } from "@magna-carta/telemetry/logger";
import { emitUsage } from "./emit.ts";
import { topicFeature } from "./feature-map.ts";

export interface MaybeEmitCompletedParams {
  readonly logger: Logger;
  readonly consented: boolean;
  readonly pepper: string | undefined;
  readonly correlationId: string;
  readonly now: string;
  readonly firmId: string;
  readonly topic: string;
}

// Maps an outbox topic to its feature and emits a firm-level "completed" usage event. The acting
// user is not carried in the outbox payload, so userIdHash is null (firm-level). An unmapped topic
// emits nothing. Completion rides the at-least-once relay, so counts are analytics-approximate.
export async function maybeEmitCompleted(params: MaybeEmitCompletedParams): Promise<void> {
  const feature = topicFeature(params.topic);
  if (feature === null) return;
  await emitUsage({
    logger: params.logger,
    consented: params.consented,
    pepper: params.pepper,
    correlationId: params.correlationId,
    now: params.now,
    feature,
    phase: "completed",
    surface: null,
    appVersion: null,
    firmId: params.firmId,
    userId: null,
  });
}
