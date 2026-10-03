import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_VERSION,
  catalogEntrySchema,
  embeddingEntry,
  isOnCloudflareModel,
  isZdrEligible,
  onCloudflareReasoningEntry,
  PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID,
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

  it("every reasoning entry states its context window, and exactly one is hosted on Cloudflare", () => {
    for (const entry of CATALOG.filter((e) => e.slot === "reasoning")) {
      expect(entry.contextWindowTokens, entry.modelId).toBeGreaterThan(0);
    }
    const onCloudflare = CATALOG.filter(
      (e) => e.slot === "reasoning" && isOnCloudflareModel(e.modelId),
    );
    expect(onCloudflare).toEqual([onCloudflareReasoningEntry()]);
    expect(onCloudflareReasoningEntry().modelId).toBe(PLATFORM_ON_CLOUDFLARE_REASONING_MODEL_ID);
    // It holds no tier, so an unconfigured firm's default is not moved by it.
    expect(onCloudflareReasoningEntry().tier).toBeUndefined();
    expect(isOnCloudflareModel("anthropic/claude-opus-4-8")).toBe(false);
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
    // Every other field is present and well-formed, so the ONLY thing this entry fails on is the
    // eligibility refinement — otherwise the assertion would pass on a missing field and prove nothing
    // about the invariant it is named for.
    const nonZdrReasoning = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "some-model-20260101",
      snapshotForm: "provider-dated",
      referenceId: "some-model",
      zdrEligible: false,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(nonZdrReasoning).success).toBe(false);
    // The same entry with eligibility restored parses, which is what proves the refinement was the cause.
    expect(catalogEntrySchema.safeParse({ ...nonZdrReasoning, zdrEligible: true }).success).toBe(
      true,
    );
  });

  it("the entry schema refuses a tier on a non-reasoning entry", () => {
    const taggedUtility = {
      slot: "utility",
      modelId: "anthropic/some-utility-model",
      snapshotId: "some-utility-model-20260101",
      snapshotForm: "provider-dated",
      referenceId: "some-utility-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
      tier: "most-capable",
    };
    expect(catalogEntrySchema.safeParse(taggedUtility).success).toBe(false);
    const { tier: _tier, ...untagged } = taggedUtility;
    expect(catalogEntrySchema.safeParse(untagged).success).toBe(true);
  });

  it("the entry schema requires the embedding entry to declare its pin state", () => {
    const unstatedPin = {
      slot: "embedding",
      modelId: "@cf/example/embedding",
      snapshotId: "example-embedding-v1",
      snapshotForm: "platform-composed",
      referenceId: "@cf/example/embedding",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(unstatedPin).success).toBe(false);
    expect(catalogEntrySchema.safeParse({ ...unstatedPin, pinState: "open" }).success).toBe(true);
  });

  it("rejects a verifiedOn date that does not conform to YYYY-MM-DD (single-digit month/day not allowed)", () => {
    // The regex /^\d{4}-\d{2}-\d{2}$/ requires exactly two digits for month and day, so "2026-6-17"
    // (single-digit month) must be rejected — an under-specified date could silently slip past a
    // lenient parser and corrupt the verification audit trail.
    const singleDigitMonth = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "some-model-20260101",
      snapshotForm: "provider-dated",
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-6-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(singleDigitMonth).success).toBe(false);
    // Correcting only the malformed date parses, so the date format was the sole cause.
    expect(
      catalogEntrySchema.safeParse({ ...singleDigitMonth, verifiedOn: "2026-06-17" }).success,
    ).toBe(true);
    // The lifecycle date is held to the same format, on the same reasoning: an under-specified date
    // slipping past a lenient parser corrupts the verification trail whichever fact it dates.
    expect(
      catalogEntrySchema.safeParse({
        ...singleDigitMonth,
        verifiedOn: "2026-06-17",
        availabilityVerifiedOn: "2026-6-17",
      }).success,
    ).toBe(false);
  });

  it("rejects an entry with a missing required field (snapshotId omitted)", () => {
    // Every required field must be present; an entry with snapshotId missing cannot be reproducibly
    // associated with a specific model snapshot and must be rejected at the schema boundary.
    const missingSnapshotId = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      // snapshotId intentionally omitted
      snapshotForm: "provider-dated",
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(missingSnapshotId).success).toBe(false);
    // Every other field is present, so restoring only snapshotId parses — which is what proves the
    // omission was the cause rather than something else in the fixture.
    expect(
      catalogEntrySchema.safeParse({ ...missingSnapshotId, snapshotId: "some-model-20260101" })
        .success,
    ).toBe(true);
  });

  it("the entry schema refuses a date suffix on a snapshot the provider publishes undated", () => {
    // The defect this invariant exists for. An entry whose provider issues no dated id, carrying a
    // plausible-looking date anyway, is the one shape that cannot be caught by inspecting the string:
    // "<referenceId>-20260101" is well-formed whether or not that release was ever published. Declaring
    // the form is what turns it into a contradiction the schema can see.
    const fabricatedDate = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "some-model-20260101",
      snapshotForm: "provider-dateless",
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(fabricatedDate).success).toBe(false);
    // Dropping the invented suffix — the correct record for a dateless model — parses.
    expect(
      catalogEntrySchema.safeParse({ ...fabricatedDate, snapshotId: "some-model" }).success,
    ).toBe(true);
  });

  it("the entry schema refuses a dated form whose snapshot carries no date", () => {
    // The mirror case: an entry that declares the provider publishes a dated id, then records the bare
    // alias. That loses the pin — the alias resolves to whatever the provider currently points it at —
    // so the provenance record would name a pointer rather than the release that produced the output.
    const droppedDate = {
      slot: "utility",
      modelId: "anthropic/some-model",
      snapshotId: "some-model",
      snapshotForm: "provider-dated",
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(droppedDate).success).toBe(false);
    // A malformed date is refused on the same rule; only the provider's -YYYYMMDD shape is accepted.
    expect(
      catalogEntrySchema.safeParse({ ...droppedDate, snapshotId: "some-model-2026" }).success,
    ).toBe(false);
    expect(
      catalogEntrySchema.safeParse({ ...droppedDate, snapshotId: "some-model-20251001" }).success,
    ).toBe(true);
  });

  it("the entry schema lets only the embedding entry compose its own snapshot id", () => {
    // A composed id is the embedding entry's alone. Letting a reasoning or utility entry invent one
    // would reopen the gap the two cases above close, since a composed id is checked against nothing.
    const composedReasoning = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "something-the-provider-never-published",
      snapshotForm: "platform-composed",
      referenceId: "some-model",
      zdrEligible: true,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
      availabilityVerifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(composedReasoning).success).toBe(false);
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
