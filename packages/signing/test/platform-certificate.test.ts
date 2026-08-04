import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";

import { fromBase64, toArrayBuffer } from "../src/bytes.ts";
import { buildDetachedCms, verifyDetachedCms } from "../src/cms.ts";
import { generatePlatformSealIdentity } from "../src/platform-certificate.ts";

const NOT_BEFORE = new Date("2026-01-01T00:00:00Z");
const NOT_AFTER = new Date("2036-01-01T00:00:00Z");

// 2048 keeps the suite fast; the production default is 3072. The generator's behavior is identical.
const options = {
  commonName: "Magna Carta Platform Seal",
  organizationName: "Magna Carta",
  countryName: "US",
  notBefore: NOT_BEFORE,
  notAfter: NOT_AFTER,
  modulusLength: 2048,
};

function parse(identity: { certificateDerBase64: string }): pkijs.Certificate {
  return pkijs.Certificate.fromBER(toArrayBuffer(fromBase64(identity.certificateDerBase64)));
}

// Looks up an extension and fails the test with a readable message when it is absent, so a missing
// extension reports as an assertion rather than a TypeError inside the unwrapping below.
function extensionById(certificate: pkijs.Certificate, id: string): pkijs.Extension {
  const found = certificate.extensions?.find((candidate) => candidate.extnID === id);
  expect(found, `certificate is missing the extension ${id}`).toBeDefined();
  return found as pkijs.Extension;
}

describe("generatePlatformSealIdentity", () => {
  it("produces a key that actually seals: the CMS it signs verifies against its own certificate", async () => {
    const identity = await generatePlatformSealIdentity(options);

    // Re-import the exported PKCS#8 exactly as the sign worker does — non-extractable, sign only.
    // This is the proof that matters: the provisioned secret drives a real detached CMS end to end.
    const signingKey = await crypto.subtle.importKey(
      "pkcs8",
      toArrayBuffer(fromBase64(identity.privateKeyPkcs8Base64)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signedBytes = new TextEncoder().encode("the bytes the seal covers");
    const cms = await buildDetachedCms({
      signedBytes,
      signingKey,
      certificate: fromBase64(identity.certificateDerBase64),
      signingTime: new Date("2026-08-04T12:00:00Z"),
    });

    expect(await verifyDetachedCms(cms, signedBytes, [parse(identity)])).toBe(true);
    // And a tampered range must not verify.
    const tampered = new TextEncoder().encode("the bytes the seal covers!");
    expect(await verifyDetachedCms(cms, tampered, [parse(identity)])).toBe(false);
  });

  it("is self-signed, v3, with the subject and validity it was asked for", async () => {
    const certificate = parse(await generatePlatformSealIdentity(options));

    expect(certificate.version).toBe(2); // zero-based: v3
    expect(certificate.subject.typesAndValues.map((part) => part.value.valueBlock.value)).toEqual([
      "Magna Carta Platform Seal",
      "Magna Carta",
      "US",
    ]);
    // Self-signed: issuer and subject are the same name.
    expect(certificate.issuer.typesAndValues.map((part) => part.value.valueBlock.value)).toEqual(
      certificate.subject.typesAndValues.map((part) => part.value.valueBlock.value),
    );
    expect(certificate.notBefore.value.toISOString()).toBe(NOT_BEFORE.toISOString());
    expect(certificate.notAfter.value.toISOString()).toBe(NOT_AFTER.toISOString());
  });

  it("encodes the name as one relative distinguished name per attribute, not a multi-valued RDN", async () => {
    // pkijs's default encoding collapses every attribute into a single SET, which renders as
    // "CN = ... + O = ..." and trips name comparison in some validators. The RDNSequence must be a
    // SEQUENCE of single-element SETs — assert the shape structurally rather than trusting a helper.
    const identity = await generatePlatformSealIdentity(options);
    const der = fromBase64(identity.certificateDerBase64);
    const tbs = (asn1js.fromBER(toArrayBuffer(der)).result as asn1js.Sequence).valueBlock
      .value[0] as asn1js.Sequence;
    // TBSCertificate: [0] version, serialNumber, signature, issuer, validity, subject, ...
    for (const index of [3, 5]) {
      const name = tbs.valueBlock.value[index] as asn1js.Sequence;
      expect(name.valueBlock.value).toHaveLength(3);
      for (const relativeName of name.valueBlock.value) {
        expect((relativeName as asn1js.Set).valueBlock.value).toHaveLength(1);
      }
    }
  });

  it("carries the document-signing extensions a validator expects", async () => {
    const certificate = parse(await generatePlatformSealIdentity(options));

    // basicConstraints, critical, not a CA.
    const basicConstraints = extensionById(certificate, "2.5.29.19");
    expect(basicConstraints.critical).toBe(true);
    expect((basicConstraints.parsedValue as pkijs.BasicConstraints).cA).toBe(false);

    // keyUsage, critical, digitalSignature + contentCommitment only (bits 0 and 1 => 0b1100_0000).
    const keyUsage = extensionById(certificate, "2.5.29.15");
    expect(keyUsage.critical).toBe(true);
    const usageBits = new Uint8Array(
      (keyUsage.parsedValue as asn1js.BitString).valueBlock.valueHexView,
    );
    expect(usageBits[0]).toBe(0b1100_0000);

    // extendedKeyUsage names id-kp-documentSigning (RFC 9336).
    const extendedKeyUsage = extensionById(certificate, "2.5.29.37");
    expect((extendedKeyUsage.parsedValue as pkijs.ExtKeyUsage).keyPurposes).toEqual([
      "1.3.6.1.5.5.7.3.36",
    ]);

    // subjectKeyIdentifier is the RFC 7093 160-bit value.
    const keyIdentifier = extensionById(certificate, "2.5.29.14");
    expect(
      new Uint8Array((keyIdentifier.parsedValue as asn1js.OctetString).valueBlock.valueHexView)
        .length,
    ).toBe(20);
  });

  it("reports a fingerprint that is the SHA-256 of the certificate it returns", async () => {
    const identity = await generatePlatformSealIdentity(options);

    const der = fromBase64(identity.certificateDerBase64);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(der)));
    const expected = Array.from(digest)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(identity.certificateFingerprintSha256).toBe(expected);
    // The PEM must wrap the same bytes the DER secret carries.
    expect(identity.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    expect(identity.certificatePem.replace(/-----[^\n]+-----|\n/g, "")).toBe(
      identity.certificateDerBase64,
    );
  });

  it("mints a positive, unpredictable serial number rather than a fixed one", async () => {
    const first = await generatePlatformSealIdentity(options);
    const second = await generatePlatformSealIdentity(options);

    expect(first.serialNumberHex).not.toBe(second.serialNumberHex);
    expect(first.serialNumberHex).toMatch(/^[0-9a-f]{32}$/);
    // Top bit clear keeps the DER INTEGER unambiguously positive.
    expect(parseInt(first.serialNumberHex.slice(0, 2), 16) & 0x80).toBe(0);
  });

  it("refuses a validity window that ends before it starts", async () => {
    await expect(
      generatePlatformSealIdentity({ ...options, notBefore: NOT_AFTER, notAfter: NOT_BEFORE }),
    ).rejects.toThrow(RangeError);
  });
});
