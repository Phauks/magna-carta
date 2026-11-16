import { createGatewayInferencePort } from "@magna-carta/inference/gateway";
import type { InferencePort } from "@magna-carta/inference/port";
import { createStubInferencePort } from "@magna-carta/inference/stub";
import type { Bindings } from "../bindings.ts";

// Resolve the active inference implementation for the assistant.
//
// The gateway port is selected only by the explicit switch over the authenticated AI binding. A firm
// still reaches no provider until its own two consent settings are open (consent.ts), so the switch
// being on transmits nothing for a firm that has not chosen the assistant.
//
// Note what this function does NOT do: it chooses an IMPLEMENTATION, never a model. The model is the
// firm's own `inference.primaryReasoningModel`, read per call through the firm-scoped data-access
// layer, so no model id is a constant in any business module.

// The deploy-time switch, in `wrangler.jsonc` so every deploy carries it (owner ruling, 2026-11-14:
// a value set only in the dashboard is replaced by the next deploy, which is how production came to
// answer every question with the stub). Exactly two values select a port; anything else, including
// its absence, selects none, and the consumer settles the question as unanswered and reports the
// misconfiguration. A deployment that forgot the switch therefore says so instead of handing a member
// a fake answer that reads like a real one.
const GATEWAY_ENABLED_VALUE = "gateway";
// The deterministic stub, which reaches no provider: chosen by name in `.dev.vars`, which both the
// local run and the test pool load.
const STUB_VALUE = "stub";

const ENVIRONMENT_LABEL = "production";

export function resolveMagnusInferencePort(env: Bindings): InferencePort | null {
  if (env.MAGNUS_INFERENCE_ADAPTER === GATEWAY_ENABLED_VALUE) {
    return createGatewayInferencePort({ ai: env.AI, env: ENVIRONMENT_LABEL });
  }
  if (env.MAGNUS_INFERENCE_ADAPTER === STUB_VALUE) return createStubInferencePort();
  return null;
}
