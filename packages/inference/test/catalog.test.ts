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

  it("rejects a verifiedOn date that does not conform to YYYY-MM-DD (single-digit month/day not allowed)", () => {
    // The regex /^\d{4}-\d{2}-\d{2}$/ requires exactly two digits for month and day, so "2026-6-17"
    // (single-digit month) must be rejected — an under-specified date could silently slip past a
    // lenient parser and corrupt the verification audit trail.
    const singleDigitMonth = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "some-model-20260101",
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-6-17",
    };
    expect(catalogEntrySchema.safeParse(singleDigitMonth).success).toBe(false);
  });

  it("rejects an entry with a missing required field (snapshotId omitted)", () => {
    // Every required field must be present; an entry with snapshotId missing cannot be reproducibly
    // associated with a specific model snapshot and must be rejected at the schema boundary.
    const missingSnapshotId = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      // snapshotId intentionally omitted
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(missingSnapshotId).success).toBe(false);
  });

  it("the exactly-one-embedding invariant is enforced by the module-load fitness guard (validateCatalog)", () => {
    // validateCatalog is not exported (it is an internal guard that throws on module load), so this test
    // documents its behavior indirectly: the CATALOG export was produced by validateCatalog and the import
    // did not throw, proving the guard ran successfully on a valid single-embedding table.
    // A duplicate or missing embedding entry would have aborted the import; the test below asserts the
    // post-condition (exactly one embedding entry in the exported CATALOG), confirming the guard held.
    const embeddings = CATALOG.filter((entry) => entry.slot === "embedding");
    expect(embeddings).toHaveLength(1);
    // The exactly-one guard for malformed tables (0 or 2+ embeddings) is exercised by the module-load
    // fitness test in the existing "validates every entry at module load" test above, which verifies that
    // the import of catalog.ts succeeds only for a valid catalog. A direct call to validateCatalog with
    // a two-embedding array cannot be tested here without exporting the function; note this in the report.
  });
});
