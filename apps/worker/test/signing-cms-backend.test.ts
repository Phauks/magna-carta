// PAdES e-signature — the CMS backend, proven in the real Workers runtime (workerd, via
// @cloudflare/vitest-pool-workers).
//
// What this locks in: pkijs + WebCrypto can build a verifiable DETACHED CMS/PKCS#7 seal on
// workerd, with the firm key held as a WebCrypto CryptoKey — the "crypto stays host-side in the
// Worker" backend for the platform seal. The pure-Rust pdf-core engine owns the PDF structure
// (prepare_signature → signed_bytes → embed_signature) and takes the CMS as an opaque blob; this
// is the producer of that blob. Keeping the check here guards the runtime assumption (workerd
// WebCrypto + pkijs) against dependency and platform drift.
//
// Out of scope here (built alongside the @magna-carta/signing package): the pdf-core WASM seam,
// platform-certificate provisioning, ESS signing-certificate-v2, and RFC 3161 timestamping.

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";

// pkijs needs a CryptoEngine; in workerd the global `crypto` is a full WebCrypto with `.subtle`.
function useWorkerdCrypto() {
  pkijs.setEngine(
    "workerd-webcrypto",
    new pkijs.CryptoEngine({ name: "workerd-webcrypto", crypto: crypto as unknown as Crypto }),
  );
}

const SIGN_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const;

function commonName(value: string): pkijs.AttributeTypeAndValue {
  // 2.5.4.3 = id-at-commonName.
  return new pkijs.AttributeTypeAndValue({
    type: "2.5.4.3",
    value: new asn1js.Utf8String({ value }),
  });
}

/** A throwaway self-signed cert over `keys` — stands in for the pre-provisioned platform cert. */
async function selfSignedCertificate(keys: CryptoKeyPair): Promise<pkijs.Certificate> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });
  cert.issuer.typesAndValues.push(commonName("Magna Carta Platform Seal (test)"));
  cert.subject.typesAndValues.push(commonName("Magna Carta Platform Seal (test)"));
  // Fixed validity window: explicit dates keep the test deterministic and free of a wall clock.
  cert.notBefore.value = new Date("2026-01-01T00:00:00Z");
  cert.notAfter.value = new Date("2036-01-01T00:00:00Z");
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey, pkijs.getCrypto(true));
  await cert.sign(keys.privateKey, "SHA-256", pkijs.getCrypto(true));
  return cert;
}

/** Build a detached CMS SignedData over `signedBytes` — the PAdES seal shape. */
async function buildDetachedCms(
  signedBytes: Uint8Array,
  keys: CryptoKeyPair,
  cert: pkijs.Certificate,
): Promise<Uint8Array> {
  const messageDigest = await crypto.subtle.digest("SHA-256", signedBytes);

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.ContentInfo.DATA, // detached: type set, no eContent
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: cert.issuer,
          serialNumber: cert.serialNumber,
        }),
      }),
    ],
    certificates: [cert],
  });

  signedData.signerInfos[0].signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0, // signed (authenticated) attributes
    attributes: [
      // contentType = id-data
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.3",
        values: [new asn1js.ObjectIdentifier({ value: pkijs.ContentInfo.DATA })],
      }),
      // signingTime
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.5",
        values: [new asn1js.UTCTime({ valueDate: new Date("2026-07-18T12:00:00Z") })],
      }),
      // messageDigest = SHA-256(signedBytes) — the binding to the PDF byte range
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.4",
        values: [new asn1js.OctetString({ valueHex: messageDigest })],
      }),
    ],
  });

  // messageDigest is already set, so signing covers the DER of the signed attributes (CMS §5.4).
  await signedData.sign(keys.privateKey, 0, "SHA-256", undefined, pkijs.getCrypto(true));

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

describe("PAdES CMS backend (pkijs on workerd WebCrypto)", () => {
  it("builds a detached CMS over external bytes that verifies, with the digest bound", async () => {
    useWorkerdCrypto();

    const keys = (await crypto.subtle.generateKey(SIGN_ALGORITHM, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const cert = await selfSignedCertificate(keys);

    // Stand-in for the pdf-core seal primitive's `signed_bytes` (the /ByteRange spans).
    const signedBytes = new TextEncoder().encode(
      "%PDF-1.7 pretend byte-range content for the PAdES seal",
    );

    const cmsDer = await buildDetachedCms(signedBytes, keys, cert);

    // 1. It is real DER and fits a sane /Contents reservation (the primitive reserves 16 KiB).
    expect(cmsDer.byteLength).toBeGreaterThan(0);
    expect(cmsDer.byteLength).toBeLessThan(16 * 1024);

    // 2. Re-parse independently and confirm the messageDigest attribute binds to our bytes.
    const reparsed = pkijs.ContentInfo.fromBER(cmsDer);
    const parsedSigned = new pkijs.SignedData({ schema: reparsed.content });
    expect(parsedSigned.certificates).toHaveLength(1);

    const expectedDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", signedBytes));
    const mdAttr = parsedSigned.signerInfos[0].signedAttrs?.attributes.find(
      (a) => a.type === "1.2.840.113549.1.9.4",
    );
    expect(mdAttr).toBeDefined();
    const boundDigest = new Uint8Array(
      (mdAttr!.values[0] as asn1js.OctetString).valueBlock.valueHexView,
    );
    expect(boundDigest).toEqual(expectedDigest);

    // 3. The signature verifies against the external byte range (the real PAdES check).
    const result = await parsedSigned.verify({
      signer: 0,
      data: signedBytes.buffer.slice(
        signedBytes.byteOffset,
        signedBytes.byteOffset + signedBytes.byteLength,
      ),
      checkChain: false,
      trustedCerts: [cert],
    });
    const verified = typeof result === "boolean" ? result : result.signatureVerified;
    expect(verified).toBe(true);
  });

  it("rejects a CMS whose bound bytes were tampered with", async () => {
    useWorkerdCrypto();
    const keys = (await crypto.subtle.generateKey(SIGN_ALGORITHM, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const cert = await selfSignedCertificate(keys);
    const signedBytes = new TextEncoder().encode("original byte range");
    const cmsDer = await buildDetachedCms(signedBytes, keys, cert);

    const parsed = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(cmsDer).content });
    const tampered = new TextEncoder().encode("tampered byte range!");

    // pkijs signals a broken binding either by returning false or by throwing a
    // SignedDataVerifyError ("Message digest doesn't match"). Both are a valid rejection — the
    // seal must NOT report a tampered range as verified.
    let verified: boolean;
    try {
      const result = await parsed.verify({
        signer: 0,
        data: tampered.buffer.slice(
          tampered.byteOffset,
          tampered.byteOffset + tampered.byteLength,
        ),
        checkChain: false,
        trustedCerts: [cert],
      });
      verified = typeof result === "boolean" ? result : result.signatureVerified;
    } catch {
      verified = false;
    }
    expect(verified).toBe(false);
  });
});
