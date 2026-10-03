import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

describe("catalog zdrEligible invariant (fitness)", () => {
  it("every selectable reasoning model is ZDR-eligible — non-ZDR never enters the reasoning slot", () => {
    for (const entry of CATALOG.filter((e) => e.slot === "reasoning")) {
      expect(entry.zdrEligible, entry.modelId).toBe(true);
    }
  });

  it("exactly one embedding entry exists (the platform-fixed, index-pinned model)", () => {
    expect(CATALOG.filter((e) => e.slot === "embedding")).toHaveLength(1);
  });

  it("exactly one transcription entry exists (the platform-fixed speech-to-text model)", () => {
    expect(CATALOG.filter((e) => e.slot === "transcription")).toHaveLength(1);
  });
});

describe("recorded provenance is the provider's, not something that resembles it (fitness)", () => {
  // The snapshot id is written into every per-request provenance record, and that record exists to
  // answer which exact model produced an output. Transcripts here are firm work product and
  // discoverable, so a field that answers confidently and wrongly is worse than one that is empty.
  //
  // The schema in src/catalog.ts already refuses an id that contradicts its own declared form, and it
  // refuses it at import rather than here. What this suite adds is the part a structural rule cannot
  // reach: whether the values are the ones a human actually read off the provider's reference. That is
  // why these are literals. If one fails, do not adjust it to match the catalog — re-read the provider's
  // model reference, and change both together only if the provider genuinely restated the id.

  it("no snapshot id is a bare undated name where the provider publishes a dated one", () => {
    for (const entry of CATALOG.filter((e) => e.snapshotForm === "provider-dated")) {
      expect(entry.snapshotId, entry.modelId).not.toBe(entry.referenceId);
    }
  });

  it("the recorded snapshot ids are the provider's published pins", () => {
    const recorded = Object.fromEntries(CATALOG.map((e) => [e.modelId, e.snapshotId]));
    expect(recorded).toEqual({
      // Published dateless: from the 4.6 generation on, the undated id is itself the pinned snapshot.
      "anthropic/claude-opus-4-8": "claude-opus-4-8",
      "anthropic/claude-sonnet-4-6": "claude-sonnet-4-6",
      // Published dateless: Cloudflare issues no dated form of its Workers AI model ids.
      "@cf/meta/llama-4-scout-17b-16e-instruct": "@cf/meta/llama-4-scout-17b-16e-instruct",
      // Predates that change, so the undated name is an alias and the dated id is the pin.
      "anthropic/claude-haiku-4-5": "claude-haiku-4-5-20251001",
      // Composed rather than published: the model paired with the index generation its vectors belong to.
      "@cf/baai/bge-large-en-v1.5": "bge-large-en-v1.5-vectorize-index-v1",
      // Published dateless: Cloudflare issues no dated form of its Workers AI model ids.
      "@cf/openai/whisper-large-v3-turbo": "@cf/openai/whisper-large-v3-turbo",
    });
  });
});
