import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z } from "zod";
import type { InferenceModelId } from "./port.ts";

// The single curated source of truth for which models exist, what they retain, and which slot they may
// fill. Eligibility is VERIFIED DATA, not a constant trusted blindly: model ids and retention/ZDR facts
// are re-checked against the Anthropic reference per release (verifiedOn records the last check). The
// catalog is validated at module load, so a malformed entry fails loud at import — never at first
// inference.
//
// A model identifier is a PERISHABLE fact. Providers ship successors and retire predecessors on their
// own schedule, and neither event announces itself to this repository, so every entry carries the two
// dates and the two provider-published facts that let ./model-pin-freshness.ts say when an entry is due
// for a human's attention. Nothing in this file acts on those facts by itself: which model the platform
// runs is a decision, and the freshness pass exists to put that decision in front of someone rather than
// to make it for them.

// "transcription" is platform-fixed for the same structural reason as "embedding": the operation that
// uses it takes no model argument, so no firm can select a different one.
export type ModelSlot = "reasoning" | "utility" | "embedding" | "transcription";

// The platform-maintained, evergreen name a reasoning selection resolves through. The tier is what other
// code and configuration refer to; WHICH curated model occupies it is data in this file. Tracking model
// advancement is therefore a catalog edit or a deploy-configuration override, not an edit to any call
// site — the provider publishes no evergreen alias of its own, so an evergreen name only exists if the
// platform maintains one. Every id it publishes resolves to a pinned snapshot: on its newer models the
// undated id IS the snapshot, and on older ones the undated name is a convenience alias for a dated one.
// Neither form ever floats forward to a successor, which is exactly why a tier has to exist here.
export type ReasoningTier = "most-capable" | "balanced";

export const REASONING_TIERS: readonly ReasoningTier[] = ["most-capable", "balanced"];

// Whether the platform embedding model may still change.
//
// "open"   — no vector index exists anywhere in the platform, so the model can be swapped for the cost
//            of editing this file. This is the only window in which the choice is free.
// "frozen" — at least one index holds vectors. Every stored vector is a function of the model that
//            produced it, so a swap does not migrate: it silently makes stored vectors and query
//            vectors incomparable unless every corpus is re-embedded from source. There is no mechanism
//            that makes a frozen pin cheaply changeable, and this file does not pretend otherwise.
//
// The transition runs one way, and the fitness gate in test/fitness-model-pin-rot.test.ts is what keeps
// the state honest: while the state reads "open" no code may write a vector, so the day the first index
// is built the gate fails until the pin decision has been made and recorded here.
export type EmbeddingPinState = "open" | "frozen";

// Which FORM the provider publishes this entry's pinned snapshot in — a fact read off the provider's own
// model reference, not a shape inferred from the string.
//
// It has to be recorded rather than derived, and that is the whole reason this field exists: whether a
// provider publishes a dated snapshot id for a given model is simply not present anywhere in this
// repository. Without it, a fabricated date suffix is indistinguishable from a real one, because both
// are "the reference id plus a dash and eight digits". With it, the contradiction is checkable, and the
// schema below checks it.
//
// "provider-dated"    — the provider publishes a dated id for this model and snapshotId IS that id
//                       (referenceId plus a -YYYYMMDD suffix). For these models the undated name is a
//                       convenience alias that resolves to the dated id, so the date carries real
//                       information and dropping it would lose the pin.
// "provider-dateless" — the provider publishes no dated form; the undated id is ITSELF the pinned
//                       snapshot rather than a pointer to one, so snapshotId equals referenceId. The
//                       equality is the honest record, not a gap in it: there is no date to record
//                       because the provider issues none, and inventing one would name a release that
//                       does not exist.
// "platform-composed" — no provider snapshot identifier applies. The embedding entry composes its own,
//                       binding the model to the index generation its vectors belong to, because that
//                       pairing (not the model alone) is what makes a stored vector interpretable.
export type SnapshotForm = "provider-dated" | "provider-dateless" | "platform-composed";

export interface CatalogEntry {
  // The slot the model may fill.
  readonly slot: ModelSlot;
  // The gateway-routable, provider-prefixed id passed to the AI binding.
  readonly modelId: InferenceModelId;
  // The pinned snapshot in effect — persisted per run so a result is reproducible.
  //
  // This value is written into the per-request provenance record, which exists to answer WHICH EXACT
  // MODEL produced a given output. Transcripts are firm work product and discoverable, so a value here
  // that names a release the provider never published is worse than no value at all: absence prompts a
  // question, a plausible-looking wrong id answers it falsely. It is therefore always the provider's own
  // published pinned identifier, copied verbatim, in whichever form snapshotForm records.
  readonly snapshotId: string;
  // Which form the provider publishes the above in. See SnapshotForm.
  readonly snapshotForm: SnapshotForm;
  // The reference id used when verifying ZDR/retention facts. For Anthropic models this is the bare
  // model name (without the gateway prefix) cross-checked against the Anthropic reference. For
  // first-party Workers AI / on-Cloudflare models there is no separate Anthropic reference id, so
  // referenceId echoes modelId — the entry's own comment records where the confidentiality facts were
  // verified instead.
  readonly referenceId: string;
  // True only when the provider supports Zero-Data-Retention for this model under the gateway.
  readonly zdrEligible: boolean;
  // True when the provider will not train on the data.
  readonly noTrainingEligible: boolean;
  // ISO date the entry's CONFIDENTIALITY facts (zdrEligible, noTrainingEligible) were last verified
  // against the reference.
  readonly verifiedOn: string;
  // ISO date the entry's LIFECYCLE facts were last read from the provider's own model and deprecation
  // reference: that the id is still published, still active, what retirement date the provider names for
  // it, and — read off the same table, so dated by the same field — the pinned snapshot id and the form
  // it is published in. Deliberately separate from verifiedOn: the confidentiality facts live on a
  // different provider page, are checked by different work, and go stale independently. Collapsing them
  // into one date would let a lifecycle check silently launder a confidentiality claim nobody re-read.
  readonly availabilityVerifiedOn: string;
  // The earliest retirement date the provider publishes for this model, when it publishes one. Absent
  // where the provider names none.
  readonly retirementNotBefore?: string;
  // The provider's current-generation successor to this entry, recorded as an OBSERVATION.
  //
  // Nothing resolves a model through this field, and nothing may: a successor is not in this catalog,
  // so it has no verified confidentiality facts, and moving a tier onto it is a decision about the
  // platform's confidentiality posture rather than a derivation from a provider's release notes. The
  // field exists so the freshness pass can say "a successor exists, and nobody has decided about it".
  readonly supersededBy?: string;
  // Reasoning entries only: the tier this entry currently occupies, if any. A reasoning entry without a
  // tier is still selectable by a firm; it is simply not what an unconfigured firm resolves to.
  readonly tier?: ReasoningTier;
  // How many tokens one request to this model may hold, prompt and answer together, as the provider
  // publishes it on the model's own page (read on availabilityVerifiedOn). Required of every reasoning
  // entry, because a caller that sends a whole document — a meeting's transcript — has to know when it
  // must cut the document into parts, and a guess at this figure is a request the provider refuses.
  readonly contextWindowTokens?: number;
  // The most tokens one answer may hold, where the provider publishes a limit. Absent where it names
  // none; the caller then bounds the answer itself.
  readonly maximumOutputTokens?: number;
  // Embedding entry only: whether the pin may still move. See EmbeddingPinState.
  readonly pinState?: EmbeddingPinState;
  // Embedding entry only: the index generation these vectors belong to. Carried beside the model id so a
  // mismatch between the model that wrote an index and the model querying it is a comparable fact rather
  // than an inference from two strings that happen to look alike.
  readonly indexVersion?: string;
}

const isoDate = z.string().regex(CIVIL_DATE_PATTERN);

// True when snapshotId is exactly referenceId plus a -YYYYMMDD suffix. Built from string operations
// rather than a regex composed around referenceId, because a reference id legitimately contains regex
// metacharacters (the embedding id carries dots and slashes) and interpolating one into a pattern would
// make the check quietly mean something else.
function isDatedSnapshotOf(snapshotId: string, referenceId: string): boolean {
  const prefix = `${referenceId}-`;
  if (!snapshotId.startsWith(prefix)) return false;
  return /^\d{8}$/.test(snapshotId.slice(prefix.length));
}

// A reasoning entry that is not ZDR-eligible can never enter the reasoning slot, so the entry schema
// itself refuses it — the curated invariant is enforced at the data boundary, not only in a fitness test.
// The tier and embedding-pin fields are refined the same way, at the same boundary: a tier on a
// non-reasoning entry, or a pin state on a non-embedding entry, is a malformed entry rather than a
// harmless extra.
export const catalogEntrySchema: z.ZodType<CatalogEntry> = z
  .object({
    slot: z.enum(["reasoning", "utility", "embedding", "transcription"]),
    modelId: z.string().min(1),
    snapshotId: z.string().min(1),
    snapshotForm: z.enum(["provider-dated", "provider-dateless", "platform-composed"]),
    referenceId: z.string().min(1),
    zdrEligible: z.boolean(),
    noTrainingEligible: z.boolean(),
    verifiedOn: isoDate,
    availabilityVerifiedOn: isoDate,
    retirementNotBefore: isoDate.optional(),
    supersededBy: z.string().min(1).optional(),
    tier: z.enum(["most-capable", "balanced"]).optional(),
    contextWindowTokens: z.number().int().positive().optional(),
    maximumOutputTokens: z.number().int().positive().optional(),
    pinState: z.enum(["open", "frozen"]).optional(),
    indexVersion: z.string().min(1).optional(),
  })
  .refine((entry) => entry.slot !== "reasoning" || entry.zdrEligible, {
    message: "a reasoning model must be ZDR-eligible",
  })
  .refine((entry) => entry.tier === undefined || entry.slot === "reasoning", {
    message: "only a reasoning model may occupy a reasoning tier",
  })
  .refine((entry) => entry.pinState === undefined || entry.slot === "embedding", {
    message: "only the embedding model carries a pin state",
  })
  .refine((entry) => entry.slot !== "embedding" || entry.pinState !== undefined, {
    message: "the embedding model must declare whether its pin is open or frozen",
  })
  // The snapshot id must agree with the form its author says the provider publishes it in. This is what
  // makes a fabricated date suffix a malformed entry rather than a plausible string: writing
  // "<referenceId>-20260101" on an entry whose provider publishes no dated form now contradicts the
  // entry's own snapshotForm and fails at import.
  //
  // It is checked HERE, at the data boundary, and not in the staleness pass, because it is not a fact
  // that decays. A snapshot id that disagrees with its form is wrong the moment it is written and stays
  // wrong; a check that only fires when a gate runs would let it sit in the tree — and in every
  // provenance record written meanwhile — until someone happened to run it. What DOES decay is whether
  // the recorded form is still what the provider publishes, and that is dated by availabilityVerifiedOn
  // and reported by ./model-pin-freshness.ts along with the rest of the lifecycle facts.
  .refine(
    (entry) => entry.snapshotForm !== "provider-dateless" || entry.snapshotId === entry.referenceId,
    {
      message:
        "a provider-dateless snapshot id must equal the reference id exactly; the provider publishes no dated form for this model, so any date suffix names a release that does not exist",
    },
  )
  .refine(
    (entry) =>
      entry.snapshotForm !== "provider-dated" ||
      isDatedSnapshotOf(entry.snapshotId, entry.referenceId),
    {
      message:
        "a provider-dated snapshot id must be the reference id followed by the provider's -YYYYMMDD suffix",
    },
  )
  // A composed snapshot id is the embedding entry's alone: it is the one entry whose pin is a
  // model-and-index pairing rather than something the provider publishes, and letting a reasoning or
  // utility entry compose its own id would reopen exactly the gap above.
  .refine((entry) => entry.snapshotForm !== "platform-composed" || entry.slot === "embedding", {
    message: "only the embedding model composes its own snapshot id",
  })
  .refine((entry) => entry.slot !== "embedding" || entry.snapshotForm === "platform-composed", {
    message: "the embedding model's snapshot id is composed, not provider-published",
  });

// Table-level version + effective date — the hook a future eval harness attaches to (nothing to
// evaluate yet).
export const CATALOG_VERSION = 5;
export const CATALOG_EFFECTIVE_DATE = "2026-10-03";

// The tier an unconfigured firm resolves to. A tier rather than a model id is the whole point: this
// constant does not change when the platform moves to a newer model.
export const PLATFORM_DEFAULT_REASONING_TIER: ReasoningTier = "most-capable";

// CONFIRM BEFORE THE FIRST VECTOR IS WRITTEN: this id must equal the embedding model every stored vector
// was produced by — a mismatch silently corrupts similarity rather than failing. It is platform-fixed (no
// firm selects it) and versioned with the index. The reasoning/utility ids and their ZDR facts are
// verified against the Anthropic reference; this embedding id is pinned to the index, not asserted
// ZDR-verified by the reasoning-reference process.
export const PLATFORM_EMBEDDING_MODEL_ID = "@cf/baai/bge-large-en-v1.5";

// The platform-fixed speech-to-text model. Like the embedding id it is the one place this model is
// named: the transcription operation closes over the catalog entry below, and no caller passes a model.
// Unlike the embedding pin it binds no stored index, so moving it costs a re-verification of the entry
// and nothing else — transcripts already written keep the model id they recorded.
export const PLATFORM_TRANSCRIPTION_MODEL_ID = "@cf/openai/whisper-large-v3-turbo";

// THE REASONING MODEL HOSTED ON CLOUDFLARE ITSELF, so a privileged conversation sent to it never leaves
// the platform for a third-party provider. A firm may select it like any other reasoning entry; it holds
// no tier, so an unconfigured firm's default is unchanged by it. It is what a feature that must not send
// content to a third party without the firm's leave — a meeting's summary — runs on by default.
export const PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

// Whether a model runs on Cloudflare's own infrastructure. Read off the id's `@cf/` prefix because that
// prefix is exactly what the AI binding routes on — a `@cf/` id is run by Workers AI and anything else is
// sent through the gateway to its provider — so a recorded field could only ever disagree with what
// actually happens to the request.
export function isOnCloudflareModel(modelId: string): boolean {
  return modelId.startsWith("@cf/");
}

// The launch catalog. Reasoning models first, each on the tier it currently occupies; the small utility
// model; the platform-fixed embedding model pinned to the index generation; the platform-fixed
// speech-to-text model. claude-fable-5 is
// intentionally absent — it mandates a retention window and returns a hard error under ZDR, so it is not
// ZDR-eligible and never enters the reasoning slot.
const RAW_CATALOG: readonly CatalogEntry[] = [
  {
    slot: "reasoning",
    tier: "most-capable",
    modelId: "anthropic/claude-opus-4-8",
    // The provider publishes no dated id for this model: from the 4.6 generation onward its ids use a
    // dateless format that is itself a pinned snapshot rather than a pointer to one. The undated id IS
    // the pin, so recording it unchanged is the complete provenance, not an abbreviation of it.
    snapshotId: "claude-opus-4-8",
    snapshotForm: "provider-dateless",
    referenceId: "claude-opus-4-8",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
    availabilityVerifiedOn: "2026-08-14",
    retirementNotBefore: "2027-05-28",
    supersededBy: "claude-opus-5",
    // Read 2026-10-03 at https://platform.claude.com/docs/en/models/opus-4-8/overview: "Context window:
    // 1M tokens · Max output: 128K tokens" (the synchronous Messages API limit).
    contextWindowTokens: 1_000_000,
    maximumOutputTokens: 128_000,
  },
  {
    slot: "reasoning",
    tier: "balanced",
    modelId: "anthropic/claude-sonnet-4-6",
    // Dateless for the same reason as the entry above: this is the 4.6 generation, where the published
    // id is the pinned snapshot itself.
    snapshotId: "claude-sonnet-4-6",
    snapshotForm: "provider-dateless",
    referenceId: "claude-sonnet-4-6",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
    availabilityVerifiedOn: "2026-08-14",
    retirementNotBefore: "2027-02-17",
    supersededBy: "claude-sonnet-5",
    // Read 2026-10-03 at https://platform.claude.com/docs/en/models/sonnet-4-6/overview: "Context
    // window: 1M tokens · Max output: 128K tokens".
    contextWindowTokens: 1_000_000,
    maximumOutputTokens: 128_000,
  },
  {
    // Workers AI on-Cloudflare reasoning model. The confidentiality facts rest on Cloudflare's Workers AI
    // data terms, read 2026-10-03 at https://developers.cloudflare.com/workers-ai/platform/data-usage/ —
    // Customer Content is not used to train any model, is not made available to another customer, and is
    // stored only where we ourselves store it — and the model is Cloudflare-hosted, so the conversation
    // does not leave the platform for a third-party provider (ZDR is a third-party provider's concept;
    // the embedding entry below reasons the same way).
    //
    // Cloudflare publishes no dated form of its Workers AI model ids and no retirement date for this one.
    // Model page read 2026-10-03:
    // https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/ — "Context
    // Window: 131,000 tokens"; `max_tokens` defaults to 256 and the page publishes no upper limit, so the
    // entry records none and a caller asks for the answer length it needs. Chat input is a `messages`
    // array whose instruction is a `system`-role message.
    slot: "reasoning",
    modelId: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
    snapshotId: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
    snapshotForm: "provider-dateless",
    referenceId: PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-10-03",
    availabilityVerifiedOn: "2026-10-03",
    contextWindowTokens: 131_000,
  },
  {
    slot: "utility",
    modelId: "anthropic/claude-haiku-4-5",
    // This model predates the dateless generation, so its undated name is a convenience alias and the
    // provider's published pin is the dated id below. Here the date is load-bearing: recording the alias
    // instead would name a pointer rather than the release that produced the output.
    snapshotId: "claude-haiku-4-5-20251001",
    snapshotForm: "provider-dated",
    referenceId: "claude-haiku-4-5",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
    availabilityVerifiedOn: "2026-08-14",
    retirementNotBefore: "2026-10-15",
    // Read 2026-10-03 at https://platform.claude.com/docs/en/about-claude/models/overview: "200K tokens"
    // context, "64K tokens" max output.
    contextWindowTokens: 200_000,
    maximumOutputTokens: 64_000,
  },
  {
    // Workers AI on-Cloudflare embedding model. Confidentiality rests on Cloudflare's own data terms
    // (ZDR is an Anthropic/third-party concept; Cloudflare AI runs on-platform). zdrEligible and
    // noTrainingEligible reflect first-party reality: Cloudflare does not train on Workers AI
    // inference data under standard terms, and data does not leave the Cloudflare platform.
    //
    // The pin is OPEN: no vector index exists anywhere in the platform, so this model can still be
    // changed for the cost of editing this line. Cloudflare publishes no retirement date for its Workers
    // AI models, so this entry carries none — the lifecycle rule that covers the Anthropic entries has
    // nothing to read here, which is why the pin-state gate rather than a date is what protects it.
    slot: "embedding",
    modelId: PLATFORM_EMBEDDING_MODEL_ID,
    snapshotId: "bge-large-en-v1.5-vectorize-index-v1",
    snapshotForm: "platform-composed",
    referenceId: PLATFORM_EMBEDDING_MODEL_ID,
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
    availabilityVerifiedOn: "2026-08-14",
    pinState: "open",
    indexVersion: "vectorize-index-v1",
  },
  {
    // Workers AI on-Cloudflare speech-to-text model, the platform-fixed transcription slot. The
    // confidentiality facts rest on Cloudflare's Workers AI data terms, read 2026-10-03 at
    // https://developers.cloudflare.com/workers-ai/platform/data-usage/ — Customer Content (the audio
    // in, the transcript out) is not used to train any model and is not made available to another
    // customer, and it is stored only where we ourselves store it. The model is Cloudflare-hosted, so
    // the audio does not leave the platform for a third-party provider.
    //
    // Cloudflare publishes no dated form of its Workers AI model ids and no retirement date for this
    // one (model page read 2026-10-03:
    // https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/), so the published id
    // is itself the pin and the entry carries no retirement date.
    slot: "transcription",
    modelId: PLATFORM_TRANSCRIPTION_MODEL_ID,
    snapshotId: PLATFORM_TRANSCRIPTION_MODEL_ID,
    snapshotForm: "provider-dateless",
    referenceId: PLATFORM_TRANSCRIPTION_MODEL_ID,
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-10-03",
    availabilityVerifiedOn: "2026-10-03",
  },
];

// Module-load validation: every entry parses (all fields present, every reasoning entry ZDR-eligible),
// exactly one entry fills each platform-fixed slot (embedding, transcription), every reasoning entry
// states its context window, exactly one reasoning entry is hosted on Cloudflare, and every reasoning tier
// has exactly one occupant so the platform default always resolves. A malformed table aborts the import.
function validateCatalog(entries: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const validated = entries.map((entry) => catalogEntrySchema.parse(entry));
  for (const slot of ["embedding", "transcription"] as const) {
    const occupants = validated.filter((entry) => entry.slot === slot);
    if (occupants.length !== 1) {
      throw new Error(
        `the catalog must declare exactly one ${slot} entry (found ${occupants.length})`,
      );
    }
  }
  for (const entry of validated) {
    if (entry.slot === "reasoning" && entry.contextWindowTokens === undefined) {
      throw new Error(`reasoning entry ${entry.modelId} must declare its context window`);
    }
  }
  const onCloudflareReasoning = validated.filter(
    (entry) => entry.slot === "reasoning" && isOnCloudflareModel(entry.modelId),
  );
  if (onCloudflareReasoning.length !== 1) {
    throw new Error(
      `the catalog must declare exactly one reasoning entry hosted on Cloudflare (found ${onCloudflareReasoning.length})`,
    );
  }
  for (const tier of REASONING_TIERS) {
    const occupants = validated.filter((entry) => entry.tier === tier);
    if (occupants.length !== 1) {
      throw new Error(
        `reasoning tier "${tier}" must have exactly one occupant (found ${occupants.length})`,
      );
    }
  }
  return validated;
}

export const CATALOG: readonly CatalogEntry[] = validateCatalog(RAW_CATALOG);

const REASONING_IDS: readonly InferenceModelId[] = CATALOG.filter(
  (entry) => entry.slot === "reasoning",
).map((entry) => entry.modelId);

const ZDR_IDS: ReadonlySet<string> = new Set(
  CATALOG.filter((entry) => entry.zdrEligible).map((entry) => entry.modelId),
);

// Precomputed at module init — consistent with REASONING_IDS/ZDR_IDS; validateCatalog already
// guarantees exactly one embedding entry exists, so the find is safe to assert.
const EMBEDDING_ENTRY: CatalogEntry = (() => {
  const entry = CATALOG.find((e) => e.slot === "embedding");
  if (entry === undefined) throw new Error("no embedding entry in the catalog");
  return entry;
})();

// Precomputed at module init for the same reason: validateCatalog guarantees exactly one transcription
// entry.
const TRANSCRIPTION_ENTRY: CatalogEntry = (() => {
  const entry = CATALOG.find((e) => e.slot === "transcription");
  if (entry === undefined) throw new Error("no transcription entry in the catalog");
  return entry;
})();

// Precomputed at module init — validateCatalog already guarantees exactly one occupant per tier.
const TIER_OCCUPANTS: ReadonlyMap<ReasoningTier, CatalogEntry> = new Map(
  REASONING_TIERS.map((tier) => {
    const entry = CATALOG.find((e) => e.tier === tier);
    if (entry === undefined) throw new Error(`no occupant for reasoning tier "${tier}"`);
    return [tier, entry] as const;
  }),
);

// The ZDR-eligible reasoning subset a firm may select from (consumed by the setting schema).
export function reasoningModelIds(): readonly InferenceModelId[] {
  return REASONING_IDS;
}

// The same subset as whole entries, for a surface that offers the choice and has to show what each
// choice retains. Every entry here is ZDR-eligible by the refinement above, so a firm choosing among
// them cannot choose a model that keeps its content; what differs between them is capability, the
// pinned snapshot, and when each fact was last verified — and those are what the surface states.
export function reasoningEntries(): readonly CatalogEntry[] {
  return CATALOG.filter((entry) => entry.slot === "reasoning");
}

// The curated model currently occupying a reasoning tier. Total: every tier has an occupant by
// module-load validation, so this never returns undefined and callers need no fallback.
export function reasoningModelForTier(tier: ReasoningTier): CatalogEntry {
  const entry = TIER_OCCUPANTS.get(tier);
  if (entry === undefined) throw new Error(`no occupant for reasoning tier "${tier}"`);
  return entry;
}

// The reasoning entry hosted on Cloudflare itself — exactly one, by module-load validation.
export function onCloudflareReasoningEntry(): CatalogEntry {
  const entry = CATALOG.find(
    (candidate) => candidate.slot === "reasoning" && isOnCloudflareModel(candidate.modelId),
  );
  if (entry === undefined) throw new Error("no reasoning entry hosted on Cloudflare");
  return entry;
}

// The single platform-fixed embedding entry the embedding operation closes over.
export function embeddingEntry(): CatalogEntry {
  return EMBEDDING_ENTRY;
}

// The single platform-fixed transcription entry the transcription operation closes over.
export function transcriptionEntry(): CatalogEntry {
  return TRANSCRIPTION_ENTRY;
}

export function isZdrEligible(modelId: string): boolean {
  return ZDR_IDS.has(modelId);
}

export function catalogEntryFor(modelId: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.modelId === modelId);
}
