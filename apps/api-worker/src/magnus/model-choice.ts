import {
  catalogEntryFor,
  isOnCloudflareModel,
  REASONING_EFFORTS,
  reasoningEntries,
  type ReasoningEffort,
} from "@magna-carta/inference/catalog";

// Which model answers a question and at what effort: the member's choice in the composer, or the
// firm's model at that model's own default effort when they made none.
//
// The roster a member picks from is the same one the firm picks from on its AI settings screen
// (reasoningEntries(): the current generation, every entry zero-data-retention), so a member's choice
// can never reach a model the firm could not have chosen. The firm's model is the default and the
// one the composer shows first.
//
// Read in two places with two postures. The submission route is STRICT: a model off the roster or an
// effort the model does not take is refused, so the member is told. The queue consumer is LENIENT: the
// catalog can change between the submission and the run, and a turn already accepted is answered by the
// firm's model rather than failed for it.

export interface ModelChoice {
  readonly modelId: string;
  // Null where the model takes no effort control on the request this platform sends it (a model
  // hosted on Cloudflare), so nothing is sent and nothing is recorded.
  readonly effort: ReasoningEffort | null;
}

export type ModelChoiceOutcome =
  | { readonly kind: "ok"; readonly choice: ModelChoice }
  | { readonly kind: "unknown-model" }
  | { readonly kind: "unsupported-effort"; readonly modelId: string };

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

// The effort levels a model takes on the request this platform sends it. Empty for a model hosted on
// Cloudflare, whose chat request has no effort field (packages/inference/src/port.ts says why).
export function effortLevelsFor(modelId: string): readonly ReasoningEffort[] {
  if (isOnCloudflareModel(modelId)) return [];
  return catalogEntryFor(modelId)?.effortLevels ?? [];
}

export function defaultEffortFor(modelId: string): ReasoningEffort | null {
  if (isOnCloudflareModel(modelId)) return null;
  return catalogEntryFor(modelId)?.defaultEffort ?? null;
}

export function resolveModelChoice(
  firmModelId: string,
  requested: { readonly modelId?: string | undefined; readonly effort?: string | null | undefined },
): ModelChoiceOutcome {
  const modelId = requested.modelId ?? firmModelId;
  if (
    requested.modelId !== undefined &&
    !reasoningEntries().some((entry) => entry.modelId === requested.modelId && entry.zdrEligible)
  ) {
    return { kind: "unknown-model" };
  }
  const levels = effortLevelsFor(modelId);
  if (requested.effort === undefined || requested.effort === null) {
    return { kind: "ok", choice: { modelId, effort: defaultEffortFor(modelId) } };
  }
  if (!isReasoningEffort(requested.effort) || !levels.includes(requested.effort)) {
    return { kind: "unsupported-effort", modelId };
  }
  return { kind: "ok", choice: { modelId, effort: requested.effort } };
}

// The consumer's lenient read: whatever the job carries, an answer comes from a model the catalog
// still offers. A choice that no longer resolves falls back to the firm's model at its default.
export function modelChoiceForRun(
  firmModelId: string,
  requested: { readonly modelId?: string | undefined; readonly effort?: string | null | undefined },
): ModelChoice {
  const outcome = resolveModelChoice(firmModelId, requested);
  if (outcome.kind === "ok") return outcome.choice;
  if (outcome.kind === "unsupported-effort") {
    return { modelId: outcome.modelId, effort: defaultEffortFor(outcome.modelId) };
  }
  return { modelId: firmModelId, effort: defaultEffortFor(firmModelId) };
}

// A model as the availability read reports it, or null where the catalog no longer carries it.
export function answeringModelBody(modelId: string): {
  modelId: string;
  displayName: string;
  snapshotId: string;
  zeroDataRetention: boolean;
  effortLevels: ReasoningEffort[];
  defaultEffort: ReasoningEffort | null;
} | null {
  const entry = catalogEntryFor(modelId);
  if (entry === undefined) return null;
  return {
    modelId: entry.modelId,
    displayName: entry.displayName,
    snapshotId: entry.snapshotId,
    zeroDataRetention: entry.zdrEligible,
    effortLevels: [...effortLevelsFor(entry.modelId)],
    defaultEffort: defaultEffortFor(entry.modelId),
  };
}

// Every model a member may choose in the composer: the firm's own roster.
export function chooseableModelIds(): readonly string[] {
  return reasoningEntries()
    .filter((entry) => entry.zdrEligible)
    .map((entry) => entry.modelId);
}

// The submission route's refusal of a choice, naming which half of it cannot be chosen.
export function modelChoiceRefusal(outcome: Exclude<ModelChoiceOutcome, { kind: "ok" }>): {
  type: "validation";
  title: string;
  status: 422;
  detail: string;
} {
  return {
    type: "validation",
    title: "That model or effort cannot be chosen",
    status: 422,
    detail:
      outcome.kind === "unknown-model"
        ? "The model is not one this firm can be answered by."
        : "The model does not take that effort level.",
  };
}
