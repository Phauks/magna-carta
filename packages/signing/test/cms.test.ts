import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";

import { buildDetachedCms, verifyDetachedCms } from "../src/cms.ts";
import { generateSigningIdentity } from "./helpers.ts";

const SIGNING_TIME = new Date("2026-07-18T12:00:00Z");
const OID_SIGNING_CERTIFICATE_V2 = "1.2.840.113549.1.9.16.2.47";

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

  it("carries a signing-certificate-v2 attribute whose hash binds the signer certificate", async () => {
    const { keys, certificate } = await generateSigningIdentity();
    const signedBytes = new TextEncoder().encode("bytes under a PAdES-baseline seal");

    const cmsDer = await buildDetachedCms({
      signedBytes,
      signingKey: keys.privateKey,
      certificate,
      signingTime: SIGNING_TIME,
    });

    const signedData = new pkijs.SignedData({
      schema: pkijs.ContentInfo.fromBER(cmsDer.buffer.slice(0) as ArrayBuffer).content,
    });
    const attribute = signedData.signerInfos[0]?.signedAttrs?.attributes.find(
      (a) => a.type === OID_SIGNING_CERTIFICATE_V2,
    );
    expect(attribute).toBeDefined();

    // SigningCertificateV2 -> certs -> ESSCertIDv2 -> certHash (SHA-256 default, so hashAlgorithm
    // is omitted and certHash is the first field).
    const signingCertificateV2 = attribute!.values[0] as asn1js.Sequence;
    const certs = signingCertificateV2.valueBlock.value[0] as asn1js.Sequence;
    const essCertIdV2 = certs.valueBlock.value[0] as asn1js.Sequence;
    const certHash = essCertIdV2.valueBlock.value[0] as asn1js.OctetString;
    const boundHash = new Uint8Array(certHash.valueBlock.valueHexView);

    const expectedHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", certificate.toSchema().toBER(false)),
    );
    expect(boundHash).toEqual(expectedHash);

    // And the seal as a whole still verifies.
    expect(await verifyDetachedCms(cmsDer, signedBytes, [certificate])).toBe(true);
  });
});
