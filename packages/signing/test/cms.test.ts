import { describe, expect, it } from "vitest";

import { buildDetachedCms, verifyDetachedCms } from "../src/cms.ts";
import { generateSigningIdentity } from "./helpers.ts";

const SIGNING_TIME = new Date("2026-07-18T12:00:00Z");

describe("detached CMS seal", () => {
  it("builds a CMS that verifies against its byte range and fits a sane reservation", async () => {
    const { keys, certificate } = await generateSigningIdentity();
    const signedBytes = new TextEncoder().encode("the PDF byte range the seal covers");

    const cms = await buildDetachedCms({
      signedBytes,
      signingKey: keys.privateKey,
      certificate,
      signingTime: SIGNING_TIME,
    });

    expect(cms.byteLength).toBeGreaterThan(0);
    expect(cms.byteLength).toBeLessThan(16 * 1024);
    expect(await verifyDetachedCms(cms, signedBytes, [certificate])).toBe(true);
  });

  it("rejects verification when the byte range was tampered with", async () => {
    const { keys, certificate } = await generateSigningIdentity();
    const cms = await buildDetachedCms({
      signedBytes: new TextEncoder().encode("original byte range"),
      signingKey: keys.privateKey,
      certificate,
      signingTime: SIGNING_TIME,
    });

    const tampered = new TextEncoder().encode("tampered byte range!");
    expect(await verifyDetachedCms(cms, tampered, [certificate])).toBe(false);
  });

  it("accepts a DER-encoded certificate as well as a parsed one", async () => {
    const { keys, certificate } = await generateSigningIdentity();
    const certificateDer = new Uint8Array(certificate.toSchema().toBER(false));
    const signedBytes = new TextEncoder().encode("bytes signed under a DER cert");

    const cms = await buildDetachedCms({
      signedBytes,
      signingKey: keys.privateKey,
      certificate: certificateDer,
      signingTime: SIGNING_TIME,
    });

    expect(await verifyDetachedCms(cms, signedBytes, [certificate])).toBe(true);
  });
});
