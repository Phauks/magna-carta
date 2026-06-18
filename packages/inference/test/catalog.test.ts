import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_VERSION,
  catalogEntrySchema,
  embeddingEntry,
  isZdrEligible,
  reasoningModelIds,
} from "../src/catalog.ts";

describe("the curated model catalog", () => {
  it("validates every entry at module load (the import did not throw)", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    expect(CATALOG_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("ships the default reasoning model anthropic/claude-opus-4-8 in the ZDR-eligible subset", () => {
    expect(reasoningModelIds()).toContain("anthropic/claude-opus-4-8");
  });

  it("EXCLUDES claude-fable-5 — it mandates retention and is not ZDR-eligible", () => {
    expect(CATALOG.some((entry) => entry.referenceId === "claude-fable-5")).toBe(false);
  });

  it("every reasoning entry is zdrEligible", () => {
    // Guard: the loop would pass vacuously with zero reasoning entries.
    expect(reasoningModelIds().length).toBeGreaterThan(0);
    for (const entry of CATALOG.filter((e) => e.slot === "reasoning")) {
      expect(entry.zdrEligible, entry.modelId).toBe(true);
    }
  });

  it("has exactly one embedding entry, platform-fixed and ZDR-eligible (no provider hardcoded here)", () => {
    // Structural invariants only — the embedding model id is a named constant in catalog.ts that the
    // implementer confirms against the Vectorize index version; the test never pins a provider/model.
    const embeddings = CATALOG.filter((e) => e.slot === "embedding");
    expect(embeddings).toHaveLength(1);
    expect(embeddingEntry().slot).toBe("embedding");
    expect(embeddingEntry().zdrEligible).toBe(true);
  });

  it("isZdrEligible answers per model id", () => {
    expect(isZdrEligible("anthropic/claude-opus-4-8")).toBe(true);
    expect(isZdrEligible("anthropic/not-in-catalog")).toBe(false);
  });

  it("rejects a malformed entry through the entry schema (module-load guard)", () => {
    const result = catalogEntrySchema.safeParse({
      slot: "reasoning",
      modelId: "anthropic/claude-opus-4-8",
      // missing snapshotId/referenceId/zdrEligible/noTrainingEligible/verifiedOn
    });
    expect(result.success).toBe(false);
  });

  it("the entry schema enforces a reasoning entry to be zdrEligible", () => {
    const nonZdrReasoning = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "some-model-20260101",
      referenceId: "some-model",
      zdrEligible: false,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(nonZdrReasoning).success).toBe(false);
  });
});
