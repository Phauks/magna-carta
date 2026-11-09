import { createGatewayInferencePort } from "@magna-carta/inference/gateway";
import type { InferencePort } from "@magna-carta/inference/port";
import { createStubInferencePort } from "@magna-carta/inference/stub";
import type { Bindings } from "../bindings.ts";

// Resolve the active inference implementation for the assistant.
//
// The gateway port is selected only when BOTH the authenticated AI binding and the explicit enabling
// configuration are present; absence resolves to the deterministic stub, which reaches no provider.
// That is the same shape resolveScanPort, resolveEnginePort, and resolveFlagEvaluator all take, and
// it is deliberate: the fail-safe direction is structural rather than a matter of remembering to
// configure something. A misconfigured environment produces obviously-fake answers, never real spend
// on a path nobody intended, and a default deployment of this code transmits nothing anywhere.
//
// Note what this function does NOT do: it chooses an IMPLEMENTATION, never a model. The model is the
// firm's own `inference.primaryReasoningModel`, read per call through the firm-scoped data-access
// layer, so no model id is a constant in any business module.

// The deploy-time switch. Its absence is the default, and its default is the stub — turning the
// assistant on in production is a deliberate act that also requires the firm-level settings, which
// themselves default closed.
const GATEWAY_ENABLED_VALUE = "gateway";

const ENVIRONMENT_LABEL = "production";

export function resolveMagnusInferencePort(env: Bindings): InferencePort {
  // The AI binding is always declared, so the configuration value is what actually selects: an
  // unconfigured environment — every test environment, and production until somebody sets it — gets
  // the stub.
  if (env.MAGNUS_INFERENCE_ADAPTER === GATEWAY_ENABLED_VALUE) {
    return createGatewayInferencePort({ ai: env.AI, env: ENVIRONMENT_LABEL });
  }
  return createStubInferencePort();
}
