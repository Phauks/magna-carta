import { z } from "zod";
import type { InferenceModelId } from "./port.ts";

// The single curated source of truth for which models exist, what they retain, and which slot they may
// fill. Eligibility is VERIFIED DATA, not a constant trusted blindly: model ids and retention/ZDR facts
// are re-checked against the Anthropic reference per release (verifiedOn records the last check). The
// catalog is validated at module load, so a malformed entry fails loud at import — never at first
// inference.

export type ModelSlot = "reasoning" | "utility" | "embedding";

export interface CatalogEntry {
  // The slot the model may fill.
  readonly slot: ModelSlot;
  // The gateway-routable, provider-prefixed id passed to the AI binding.
  readonly modelId: InferenceModelId;
  // The pinned snapshot in effect — persisted per run so a result is reproducible.
  readonly snapshotId: string;
  // The bare first-party id used only when verifying ZDR/retention against the Anthropic reference.
  readonly referenceId: string;
  // True only when the provider supports Zero-Data-Retention for this model under the gateway.
  readonly zdrEligible: boolean;
  // True when the provider will not train on the data.
  readonly noTrainingEligible: boolean;
  // ISO date the entry was last verified against the reference.
  readonly verifiedOn: string;
}

// A reasoning entry that is not ZDR-eligible can never enter the reasoning slot, so the entry schema
// itself refuses it — the curated invariant is enforced at the data boundary, not only in a fitness test.
export const catalogEntrySchema: z.ZodType<CatalogEntry> = z
  .object({
    slot: z.enum(["reasoning", "utility", "embedding"]),
    modelId: z.string().min(1),
    snapshotId: z.string().min(1),
    referenceId: z.string().min(1),
    zdrEligible: z.boolean(),
    noTrainingEligible: z.boolean(),
    verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((entry) => entry.slot !== "reasoning" || entry.zdrEligible, {
    message: "a reasoning model must be ZDR-eligible",
  });

// Table-level version + effective date — the hook a future eval harness attaches to (nothing to
// evaluate yet).
export const CATALOG_VERSION = 1;
export const CATALOG_EFFECTIVE_DATE = "2026-06-17";

// CONFIRM BEFORE MERGE: this id must equal the embedding model the live Vectorize index was built with —
// a mismatch silently corrupts similarity. It is platform-fixed (no firm selects it) and versioned with
// the index. The reasoning/utility ids and their ZDR facts are verified against the Anthropic reference;
// this embedding id is pinned to the index, not asserted ZDR-verified by the reasoning-reference process.
export const PLATFORM_EMBEDDING_MODEL_ID = "@cf/baai/bge-large-en-v1.5";

// The launch catalog. Reasoning default first; the small utility model; the platform-fixed embedding
// model pinned to the Vectorize index version. claude-fable-5 is intentionally absent — it mandates a
// retention window and returns a hard error under ZDR, so it is not ZDR-eligible and never enters the
// reasoning slot.
const RAW_CATALOG: readonly CatalogEntry[] = [
  {
    slot: "reasoning",
    modelId: "anthropic/claude-opus-4-8",
    snapshotId: "claude-opus-4-8-20260101",
    referenceId: "claude-opus-4-8",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
  {
    slot: "reasoning",
    modelId: "anthropic/claude-sonnet-4-6",
    snapshotId: "claude-sonnet-4-6-20260101",
    referenceId: "claude-sonnet-4-6",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
  {
    slot: "utility",
    modelId: "anthropic/claude-haiku-4-5",
    snapshotId: "claude-haiku-4-5-20260101",
    referenceId: "claude-haiku-4-5",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
  {
    // Workers AI on-Cloudflare embedding model. Confidentiality rests on Cloudflare's own data terms
    // (ZDR is an Anthropic/third-party concept; Cloudflare AI runs on-platform). zdrEligible and
    // noTrainingEligible reflect first-party reality: Cloudflare does not train on Workers AI
    // inference data under standard terms, and data does not leave the Cloudflare platform.
    slot: "embedding",
    modelId: PLATFORM_EMBEDDING_MODEL_ID,
    snapshotId: `${PLATFORM_EMBEDDING_MODEL_ID}@vectorize-index-v1`,
    referenceId: PLATFORM_EMBEDDING_MODEL_ID,
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
];

// Module-load validation: every entry parses (all fields present, every reasoning entry ZDR-eligible),
// and exactly one embedding entry exists. A malformed table aborts the import.
function validateCatalog(entries: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const validated = entries.map((entry) => catalogEntrySchema.parse(entry));
  const embeddings = validated.filter((entry) => entry.slot === "embedding");
  if (embeddings.length !== 1) {
    throw new Error(`the catalog must declare exactly one embedding entry (found ${embeddings.length})`);
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

// The ZDR-eligible reasoning subset a firm may select from (consumed by the setting schema).
export function reasoningModelIds(): readonly InferenceModelId[] {
  return REASONING_IDS;
}

// The single platform-fixed embedding entry the embedding operation closes over.
export function embeddingEntry(): CatalogEntry {
  const entry = CATALOG.find((candidate) => candidate.slot === "embedding");
  if (entry === undefined) throw new Error("no embedding entry in the catalog");
  return entry;
}

export function isZdrEligible(modelId: string): boolean {
  return ZDR_IDS.has(modelId);
}

export function catalogEntryFor(modelId: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.modelId === modelId);
}
