import { describe, expect, it } from "vitest";
import {
  parseCaptureAddress,
  resolveCaptureRouting,
  type FirmResolver,
} from "../src/routing.ts";

const ROOT = "in.magnacarta.esq";

describe("parseCaptureAddress", () => {
  it("splits the firm subdomain from the matter-token local part", () => {
    expect(parseCaptureAddress("matter-abc123@firm_xyz.in.magnacarta.esq", ROOT)).toEqual({
      firmSubdomain: "firm_xyz",
      localPart: "matter-abc123",
    });
  });

  it("treats a firm catch-all local part as an ordinary token (resolved to no matter downstream)", () => {
    expect(parseCaptureAddress("catchall@firm_xyz.in.magnacarta.esq", ROOT)).toEqual({
      firmSubdomain: "firm_xyz",
      localPart: "catchall",
    });
  });

  it("rejects addresses outside the capture zone, with no firm subdomain, or empty local part", () => {
    expect(parseCaptureAddress("someone@example.com", ROOT)).toBe(null);
    expect(parseCaptureAddress("token@in.magnacarta.esq", ROOT)).toBe(null); // no firm subdomain label
    expect(parseCaptureAddress("token@a.b.in.magnacarta.esq", ROOT)).toBe(null); // nested subdomain
    expect(parseCaptureAddress("@firm_xyz.in.magnacarta.esq", ROOT)).toBe(null); // empty local part
    expect(parseCaptureAddress("not-an-address", ROOT)).toBe(null);
  });
});

describe("resolveCaptureRouting", () => {
  const resolver: FirmResolver = async (subdomain) =>
    subdomain === "firm_xyz" ? { firmId: "firm_xyz", bucketName: "firm-xyz-bucket" } : null;

  it("routes a valid capture address to its firm, carrying the token for the consumer", async () => {
    const routing = await resolveCaptureRouting(
      "matter-abc123@firm_xyz.in.magnacarta.esq",
      ROOT,
      resolver,
    );
    expect(routing).toEqual({
      firmId: "firm_xyz",
      bucketName: "firm-xyz-bucket",
      captureToken: "matter-abc123",
    });
  });

  it("does not route an address for an unknown firm", async () => {
    expect(
      await resolveCaptureRouting("matter-abc@unknown_firm.in.magnacarta.esq", ROOT, resolver),
    ).toBe(null);
  });

  it("does not route an address outside the capture zone", async () => {
    expect(await resolveCaptureRouting("x@example.com", ROOT, resolver)).toBe(null);
  });
});
