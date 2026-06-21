import { describe, expect, it } from "vitest";
import { decidePreview } from "../src/preview-policy.ts";
import type { CleanVersionForPreview } from "../src/queries.ts";

const base: CleanVersionForPreview = {
  id: "fileVersion_x" as never,
  r2Key: "files/f/v",
  sizeBytes: 100,
  versionNumber: 1,
  inlinePlayable: "playable",
  storageClass: "standard",
  storageEncoding: "full",
  sniffedContentType: "video/mp4",
  artifactRole: "original",
};

describe("decidePreview", () => {
  it("unlocks inline-media only when playable + standard + full + not-derived + sniffed-type-known", () => {
    expect(decidePreview(base)).toEqual({
      kind: "inline-media",
      r2Key: "files/f/v",
      sniffedContentType: "video/mp4",
      sizeBytes: 100,
    });
  });

  it("fails closed on NULL verdict (the launch state) -> download-only/unknown-verdict", () => {
    expect(decidePreview({ ...base, inlinePlayable: null })).toEqual({
      kind: "download-only",
      reason: "unknown-verdict",
    });
  });

  it("downgrades a known non-playable verdict -> download-only/verdict", () => {
    expect(decidePreview({ ...base, inlinePlayable: "download-only" })).toEqual({ kind: "download-only", reason: "verdict" });
    expect(decidePreview({ ...base, inlinePlayable: "indeterminate" })).toEqual({ kind: "download-only", reason: "verdict" });
  });

  it("fails closed on an UNKNOWN out-of-enum verdict string (the stored-XSS regression guard — must never be weakened)", () => {
    expect(decidePreview({ ...base, inlinePlayable: "totally-unknown" as never })).toEqual({
      kind: "download-only",
      reason: "verdict",
    });
  });

  it("playable but sniffedContentType null/empty -> download-only/unknown-type (the single-decision guard)", () => {
    expect(decidePreview({ ...base, sniffedContentType: null })).toEqual({ kind: "download-only", reason: "unknown-type" });
    expect(decidePreview({ ...base, sniffedContentType: "" })).toEqual({ kind: "download-only", reason: "unknown-type" });
  });

  it("playable but tiered/encoded/derived -> download-only with the matching reason", () => {
    expect(decidePreview({ ...base, storageClass: "infrequent_access" })).toEqual({ kind: "download-only", reason: "tiered" });
    expect(decidePreview({ ...base, storageEncoding: "delta" })).toEqual({ kind: "download-only", reason: "encoded" });
    expect(decidePreview({ ...base, artifactRole: "derived" })).toEqual({ kind: "download-only", reason: "derived" });
  });

  it("evaluation order: verdict is checked before content-type before tier", () => {
    expect(decidePreview({ ...base, inlinePlayable: null, sniffedContentType: null, storageClass: "infrequent_access" })).toEqual({
      kind: "download-only",
      reason: "unknown-verdict",
    });
  });
});
