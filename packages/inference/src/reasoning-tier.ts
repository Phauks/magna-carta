import {
  catalogEntryFor,
  reasoningModelForTier,
  type CatalogEntry,
  type ReasoningTier,
} from "./catalog.ts";

// Moving the platform onto a newer reasoning model without shipping code.
//
// A tier names WHAT the platform wants ("the most capable model we have verified"); the catalog says
// which model that currently is. This module lets deploy configuration say it instead, so the platform
// can move between already-verified models without a build.
//
// The override can only ever RE-POINT a tier at an entry that is already in the curated catalog. It
// cannot introduce a model, and that limit is the point rather than an omission: an entry in the catalog
// carries a human's recorded finding that the model is zero-data-retention eligible and not trained on,
// and there is no way for a deploy-time string to carry that finding. So adding a model still takes a
// code change and a re-verification, while choosing among verified models does not. Widening this to
// accept arbitrary identifiers would make the catalog advisory, and the catalog being exhaustive is what
// makes a non-eligible model unrepresentable rather than merely discouraged.
//
// Every rejection falls back to the catalog's own occupant. A typo in a deploy variable therefore
// degrades to the shipped default rather than taking inference down or, far worse, selecting something
// unverified — but it is reported rather than swallowed, so the misconfiguration is visible.

export type ReasoningTierOverrides = Readonly<Partial<Record<ReasoningTier, string>>>;

export interface ReasoningTierResolution {
  // The catalog entry the tier resolves to. Always present: a rejected override falls back to the
  // catalog occupant, so resolution is total.
  readonly entry: CatalogEntry;
  // True when a well-formed, in-catalog, eligible override replaced the catalog occupant.
  readonly overrideApplied: boolean;
  // Set only when an override was present and refused. The value is a configured model identifier, not
  // firm content, so it is safe to report through the diagnostics pipeline.
  readonly rejectedOverride?: string;
  readonly rejectionReason?: "not-in-catalog" | "not-a-reasoning-model" | "not-eligible";
}

// Resolve a tier to the model that should serve it, applying a deploy-configuration override only when
// the override names a curated, ZDR-eligible reasoning entry.
export function resolveReasoningTier(
  tier: ReasoningTier,
  overrides: ReasoningTierOverrides = {},
): ReasoningTierResolution {
  const occupant = reasoningModelForTier(tier);
  const requested = overrides[tier];
  if (requested === undefined || requested === occupant.modelId) {
    return { entry: occupant, overrideApplied: false };
  }

  const candidate = catalogEntryFor(requested);
  if (candidate === undefined) {
    return {
      entry: occupant,
      overrideApplied: false,
      rejectedOverride: requested,
      rejectionReason: "not-in-catalog",
    };
  }
  if (candidate.slot !== "reasoning") {
    return {
      entry: occupant,
      overrideApplied: false,
      rejectedOverride: requested,
      rejectionReason: "not-a-reasoning-model",
    };
  }
  // Belt and braces over the schema refinement that already forbids a non-eligible reasoning entry. The
  // cost is one comparison; the failure it guards against is firm content reaching a model that retains
  // it, so it is checked here too rather than assumed from a validation that runs elsewhere.
  if (!candidate.zdrEligible) {
    return {
      entry: occupant,
      overrideApplied: false,
      rejectedOverride: requested,
      rejectionReason: "not-eligible",
    };
  }
  return { entry: candidate, overrideApplied: true };
}

export interface ParsedReasoningTierOverrides {
  readonly overrides: ReasoningTierOverrides;
  // True when the configured value was present but could not be read. Reported rather than thrown: a
  // malformed deploy variable must not stop the platform from serving its shipped default.
  readonly malformed: boolean;
}

// Read the deploy-configuration value. A JSON object of tier to model id, e.g.
// {"most-capable":"anthropic/claude-sonnet-5-5"}. Unknown tier names and non-string values are dropped
// rather than failing the whole object, so one bad key cannot discard a good one.
export function parseReasoningTierOverrides(raw: string | undefined): ParsedReasoningTierOverrides {
  if (raw === undefined || raw.trim() === "") return { overrides: {}, malformed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { overrides: {}, malformed: true };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { overrides: {}, malformed: true };
  }
  const overrides: Partial<Record<ReasoningTier, string>> = {};
  let sawUnusable = false;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      (key === "most-capable" || key === "balanced") &&
      typeof value === "string" &&
      value !== ""
    ) {
      overrides[key] = value;
    } else {
      sawUnusable = true;
    }
  }
  return { overrides, malformed: sawUnusable };
}
