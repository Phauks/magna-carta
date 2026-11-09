/*
 * The firm's AI settings over the wire — the two consent gates, the assistant's daily allowance,
 * the model in force with its facts, and the roster the firm chooses a model from. One read and one
 * sparse write against GET/PATCH /api/v1/firm/ai/settings, both behind `firm:manageAiSettings`.
 *
 * THE ROSTER IS THE PLATFORM'S VERIFIED CATALOG. Neither the model gateway nor the AI binding lists
 * models at runtime, and the provider's own list cannot carry what the catalog carries: a person's
 * recorded finding that the model keeps nothing and trains on nothing. So the roster is as current
 * as the catalog, the response says which catalog that is, and the page states it. Where the
 * platform can read the provider's live list, the response also says whether each roster entry is
 * still published and which published models await verification — information, never choices.
 *
 * THE FIRM EITHER FOLLOWS THE PLATFORM OR HAS CHOSEN. A firm that has never chosen moves forward
 * with the platform's current model; a firm that has chosen keeps its choice until it chooses
 * again. Sending `null` returns a firm to following; sending a roster id pins it.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** What the firm is told about the model its content reaches once the gate is open. */
export interface AiModelFacts {
  modelId: string;
  /** The exact snapshot behind any given answer — what a provenance record names. */
  snapshotId: string;
  zeroDataRetention: boolean;
  noTraining: boolean;
  /** Whether the firm follows the platform's current model or has pinned this one itself. */
  selection: "platform" | "chosen";
}

/** One model the firm may choose, with the facts a choice is made on. */
/** The provider's effort control, lowest to highest. */
export type AiReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiModelChoice {
  modelId: string;
  /** The provider's own name for the model, e.g. "Claude Opus 5.5". */
  displayName: string;
  snapshotId: string;
  zeroDataRetention: boolean;
  noTraining: boolean;
  /** When the retention and training facts were last re-checked against the provider. */
  verifiedOn: string;
  /** When the model was last confirmed still published and active. */
  availabilityVerifiedOn: string;
  retirementNotBefore: string | null;
  tier: string | null;
  /** The effort levels the provider accepts for this model, lowest first. */
  effortLevels: AiReasoningEffort[];
  /** The effort the provider applies when a request names none. */
  defaultEffort: AiReasoningEffort | null;
  /** True on the entry an unconfigured firm resolves to. */
  platformDefault: boolean;
  /** Whether the provider's live list includes it; null when the list was not read. */
  published: boolean | null;
}

/** What the provider's live model list said, beside the roster. */
export interface AiProviderRoster {
  status: "live" | "not-configured" | "unreachable";
  /** When the list was last read; null when it never was. */
  checkedAt: string | null;
  /** Published models the roster does not carry yet. Shown, never offered. */
  awaitingVerification: Array<{ modelId: string; displayName: string }>;
}

export interface FirmAiSettings {
  aiProcessing: { eligible: boolean };
  /** Null when the firm's stored model is no longer one the platform carries. */
  model: AiModelFacts | null;
  models: AiModelChoice[];
  catalog: { version: number; effectiveDate: string };
  provider: AiProviderRoster;
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
  /** A roster id pins the firm to that model; null returns it to following the platform. */
  model?: { modelId: string | null };
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
