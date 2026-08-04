import { describe, expect, it } from "vitest";
import { parseCaptureAddress, resolveCaptureRouting, type FirmResolver } from "../src/routing.ts";

const ROOT = "in.magnacarta.esq";

describe("parseCaptureAddress", () => {
  it("takes the whole local part as the opaque capture token on the single zone", () => {
    expect(parseCaptureAddress("abc123xyz@in.magnacarta.esq", ROOT)).toEqual({
      token: "abc123xyz",
    });
  });

  it("lower-cases the token to match the minted form", () => {
    expect(parseCaptureAddress("ABC123XYZ@IN.MAGNACARTA.ESQ", ROOT)).toEqual({
      token: "abc123xyz",
    });
  });

  it("rejects addresses off the zone, on a nested subdomain, or with an empty local part", () => {
    expect(parseCaptureAddress("someone@example.com", ROOT)).toBe(null);
    // A per-firm subdomain is NOT this zone's catch-all — Email Routing has one zone-level rule.
    expect(parseCaptureAddress("token@firm_xyz.in.magnacarta.esq", ROOT)).toBe(null);
    expect(parseCaptureAddress("token@a.b.in.magnacarta.esq", ROOT)).toBe(null);
    expect(parseCaptureAddress("@in.magnacarta.esq", ROOT)).toBe(null);
    expect(parseCaptureAddress("not-an-address", ROOT)).toBe(null);
  });
});

describe("resolveCaptureRouting", () => {
  // The control-plane token->firm index: a minted, un-revoked token resolves to its firm.
  const resolver: FirmResolver = async (token) =>
    token === "abc123xyz" ? { firmId: "firm_xyz", bucketName: "firm-xyz-bucket" } : null;

  it("routes a minted token to its firm, carrying the token for the consumer", async () => {
    const routing = await resolveCaptureRouting("abc123xyz@in.magnacarta.esq", ROOT, resolver);
    expect(routing).toEqual({
      firmId: "firm_xyz",
      bucketName: "firm-xyz-bucket",
      captureToken: "abc123xyz",
    });
  });

  it("does not route an unminted or revoked token", async () => {
    expect(await resolveCaptureRouting("nosuchtoken@in.magnacarta.esq", ROOT, resolver)).toBe(null);
  });

  it("does not route an address outside the capture zone", async () => {
    expect(await resolveCaptureRouting("abc123xyz@example.com", ROOT, resolver)).toBe(null);
  });
});
