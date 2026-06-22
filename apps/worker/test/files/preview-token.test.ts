import { describe, expect, it } from "vitest";
import { mintPreviewDeliveryToken, verifyPreviewDeliveryToken, type PreviewTokenPayload } from "../../src/files/preview-token.ts";

const SECRET = "test-secret-value";
const payload: PreviewTokenPayload = {
  r2Key: "files/f/v",
  bucket: "R2",
  sniffedContentType: "video/mp4",
  verdict: "playable",
  exp: 2_000_000_000,
};

describe("preview delivery token", () => {
  it("round-trips a fresh token to the exact payload", async () => {
    const token = await mintPreviewDeliveryToken(SECRET, payload);
    expect(await verifyPreviewDeliveryToken(SECRET, token, 1_000_000_000)).toEqual(payload);
  });

  it("round-trips a payload with a non-ASCII sniffedContentType", async () => {
    const unicode = { ...payload, sniffedContentType: "video/mp4; name=\"clé.mp4\"" };
    const token = await mintPreviewDeliveryToken(SECRET, unicode);
    expect(await verifyPreviewDeliveryToken(SECRET, token, 1_000_000_000)).toEqual(unicode);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintPreviewDeliveryToken(SECRET, payload);
    expect(await verifyPreviewDeliveryToken("other-secret", token, 1_000_000_000)).toBeNull();
  });

  it("rejects a tampered payload (swapped r2Key)", async () => {
    const token = await mintPreviewDeliveryToken(SECRET, payload);
    const sig = token.slice(token.indexOf(".") + 1);
    const forgedBody = btoa(JSON.stringify({ ...payload, r2Key: "files/other/v" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyPreviewDeliveryToken(SECRET, `${forgedBody}.${sig}`, 1_000_000_000)).toBeNull();
  });

  it("rejects a flipped signature byte", async () => {
    const token = await mintPreviewDeliveryToken(SECRET, payload);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await verifyPreviewDeliveryToken(SECRET, flipped, 1_000_000_000)).toBeNull();
  });

  it("rejects an expired token (exp < now), only after a valid signature", async () => {
    const token = await mintPreviewDeliveryToken(SECRET, payload);
    expect(await verifyPreviewDeliveryToken(SECRET, token, 2_000_000_001)).toBeNull();
  });

  it("rejects a malformed token (no dot / bad base64)", async () => {
    expect(await verifyPreviewDeliveryToken(SECRET, "not-a-token", 1_000_000_000)).toBeNull();
    expect(await verifyPreviewDeliveryToken(SECRET, "###.###", 1_000_000_000)).toBeNull();
  });
});
