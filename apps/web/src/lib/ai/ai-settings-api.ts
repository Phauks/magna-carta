/*
 * The firm's AI settings over the wire — the two consent gates, the assistant's daily allowance,
 * and the stated facts about the model in force. One read and one sparse write against
 * GET/PATCH /api/v1/firm/ai/settings, both behind `firm:manageAiSettings`.
 *
 * The MODEL is reported and never sent: the route accepts no model field. It travels with the gates
 * because consenting to third-party processing without being told which model receives the content,
 * what it retains, and whether it trains on it, is consent to nothing legible.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** What the firm is told about the model its content reaches once the gate is open. */
export interface AiModelFacts {
  modelId: string;
  /** The exact snapshot behind any given answer — what a provenance record names. */
  snapshotId: string;
  zeroDataRetention: boolean;
  noTraining: boolean;
}

export interface FirmAiSettings {
  aiProcessing: { eligible: boolean };
  /** Null when the firm's stored model is no longer one the platform carries. */
  model: AiModelFacts | null;
  magnus: { enabled: boolean; dailyTurnCeiling: number };
}

/** The permission the AI settings routes name. Owners and administrators hold it by seed. */
export const MANAGE_AI_SETTINGS_PERMISSION = "firm:manageAiSettings";

/**
 * The ceiling's bounds, mirroring `magnusDailyTurnCeilingDefinition` in @magna-carta/magnus. Stated
 * here so the field carries them; the server enforces them regardless.
 */
export const DAILY_TURN_CEILING_MINIMUM = 0;
export const DAILY_TURN_CEILING_MAXIMUM = 100000;

export function readFirmAiSettings(fetchImpl: typeof fetch): Promise<ApiOutcome<FirmAiSettings>> {
  return requestJson(fetchImpl, "/api/v1/firm/ai/settings");
}

export interface UpdateFirmAiSettingsRequest {
  aiProcessing?: { eligible?: boolean };
  magnus?: { enabled?: boolean; dailyTurnCeiling?: number };
}

/** Opens or closes the firm's gates, for everybody; audited on the server. */
export function updateFirmAiSettings(
  fetchImpl: typeof fetch,
  request: UpdateFirmAiSettingsRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<FirmAiSettings>> {
  return requestJson(fetchImpl, "/api/v1/firm/ai/settings", {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}
