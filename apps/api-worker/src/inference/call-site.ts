import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFirmSetting, SETTING_TABLE } from "@magna-carta/data-access/setting-statements";
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

// The reasoning model the firm has CHOSEN, or null when it has not chosen one — when no row is stored,
// or what is stored is not a model the firm could select today. The setting's own read is total and
// answers the platform tier's model for a missing row, which is right for a feature that follows the
// platform and wrong for one whose default is a different model: a feature that must not send content
// to a third party unbidden asks whether the FIRM named one, and only the row says so.
export async function resolveChosenReasoningModel(
  firmDatabase: SqlDatabase,
): Promise<string | null> {
  const { results } = await firmDatabase
    .prepare(`SELECT value FROM ${SETTING_TABLE} WHERE key = ?1`)
    .bind(primaryReasoningModelDefinition.key)
    .all<{ value: string }>();
  const stored = results[0];
  if (stored === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.value);
  } catch {
    return null;
  }
  const chosen = primaryReasoningModelDefinition.schema.safeParse(parsed);
  return chosen.success ? chosen.data : null;
}
