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

// The deployment's own port, for a consumer that is handed the Worker's environment rather than the
// binding: the binding is named here, in the composition root, and nowhere in the consumer. The label
// is the deployment's, as the inference consumer's is.
export function deploymentInferencePort(environment: { readonly AI: AiBinding }): InferencePort {
  return inferencePortFor(environment.AI, "production");
}

export function resolveReasoningModel(firmDatabase: SqlDatabase): Promise<string> {
  return readFirmSetting(firmDatabase, primaryReasoningModelDefinition);
}
