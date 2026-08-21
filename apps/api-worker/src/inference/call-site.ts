import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { createGatewayInferencePort, type AiBinding } from "@magna-carta/inference/gateway";
import type { InferencePort } from "@magna-carta/inference/port";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";

// The inference call site composition: construct the port over the authenticated AI binding, and read
// the firm's selected reasoning model through the firm-scoped data-access layer (the firm's own D1
// handle — the structural tenant isolation). The model is passed as an explicit operation parameter,
// never carried on a connection or context object.

export function inferencePortFor(ai: AiBinding, env: string): InferencePort {
  return createGatewayInferencePort({ ai, env });
}

export function resolveReasoningModel(firmDatabase: SqlDatabase): Promise<string> {
  return readFirmSetting(firmDatabase, primaryReasoningModelDefinition);
}
