import { z } from "zod";

// The firm's AI settings contract: what GET/PATCH /api/v1/firm/ai/settings return and accept, as plain
// zod. Each component is named with zod's own metadata (`.meta({ id })`), which the contract emitter
// reads as the component's name, so the shape and its name live together here and the route module in
// apps/api-worker declares its routes over these. The rule and its reasoning are in
// docs/conventions/api.md (_Where a contract shape lives_).

// The four facts a firm needs about the model its content reaches: which one, the exact snapshot
// that produced any given answer, and the two confidentiality guarantees the gateway pins per
// request. `snapshotId` may equal `modelId` without a prefix — the catalog records why (a provider
// that publishes no dated form makes the undated id itself the pin). `selection` says whether the
// firm follows the platform's tier or has pinned this model itself.
export const AiModelFacts = z
  .object({
    modelId: z.string(),
    snapshotId: z.string(),
    zeroDataRetention: z.boolean(),
    noTraining: z.boolean(),
    selection: z.enum(["platform", "chosen"]),
  })
  .meta({ id: "AiModelFacts" });

// One roster entry a firm may choose: the facts above plus the dates each was last verified and the
// provider's published retirement, so a firm choosing between two verified models can see how fresh
// each verification is. `platformDefault` marks the entry an unconfigured firm resolves to.
export const AiModelChoice = z
  .object({
    modelId: z.string(),
    // The provider's own name for the model, for the reader; modelId is what a write names.
    displayName: z.string(),
    snapshotId: z.string(),
    zeroDataRetention: z.boolean(),
    noTraining: z.boolean(),
    // When the confidentiality facts (retention, training) were last re-checked against the
    // provider's reference, and when the lifecycle facts (still published, retirement date) were.
    verifiedOn: z.string(),
    availabilityVerifiedOn: z.string(),
    retirementNotBefore: z.string().nullable(),
    // The platform's evergreen tier this entry currently occupies, if any.
    tier: z.string().nullable(),
    platformDefault: z.boolean(),
    // Whether the provider's live model list includes this model: true or false when the platform
    // read the list, null when it could not or is not configured to.
    published: z.boolean().nullable(),
  })
  .meta({ id: "AiModelChoice" });

// What the provider's live model list said, and when it was read. `status` is "live" when the list
// was read, "not-configured" when the platform holds no key to read it with, and "unreachable" when
// the read failed; the roster above is the whole choice in every case.
export const AiProviderRoster = z
  .object({
    status: z.enum(["live", "not-configured", "unreachable"]),
    checkedAt: z.string().nullable(),
    // Models the provider publishes that the roster does not carry, newest first. Not selectable:
    // none has a recorded retention finding yet, and some never will (a model the provider requires
    // to retain content cannot be offered at all).
    awaitingVerification: z.array(z.object({ modelId: z.string(), displayName: z.string() })),
  })
  .meta({ id: "AiProviderRoster" });

export const FirmAiSettingsResponse = z
  .object({
    aiProcessing: z.object({ eligible: z.boolean() }),
    // Null when the firm's stored model id is not in the curated catalog at all. The setting read is
    // total (an unrecognized stored value yields the platform default), so this is unreachable
    // today; it stays nullable rather than asserted because a catalog entry can be retired while a
    // firm's row still names it, and a screen that says nothing is honest where one that names a
    // model the platform no longer carries is not.
    model: AiModelFacts.nullable(),
    // The roster the firm chooses from, and the catalog it comes from.
    models: z.array(AiModelChoice),
    catalog: z.object({ version: z.number().int(), effectiveDate: z.string() }),
    provider: AiProviderRoster,
    magnus: z.object({
      enabled: z.boolean(),
      dailyTurnCeiling: z.number().int(),
    }),
  })
  .meta({ id: "FirmAiSettingsResponse" });

export const PatchFirmAiSettingsRequest = z
  .object({
    // Sparse: a field absent is unchanged, and an empty patch writes nothing and audits nothing.
    aiProcessing: z.object({ eligible: z.boolean().optional() }).optional(),
    // The model. A string pins the firm to that roster entry; null returns the firm to following the
    // platform's tier. Absent leaves the choice alone.
    model: z.object({ modelId: z.string().min(1).nullable() }).optional(),
    magnus: z
      .object({
        enabled: z.boolean().optional(),
        // The same bounds the setting definition enforces at the write path, declared here so a bad
        // value is a 422 against the contract rather than a throw inside the effect.
        dailyTurnCeiling: z.number().int().min(0).max(100000).optional(),
      })
      .optional(),
  })
  .meta({ id: "PatchFirmAiSettingsRequest" });
