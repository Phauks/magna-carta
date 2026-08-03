// The detached CMS/PKCS#7 producer for the PAdES platform seal.
//
// The seal is a detached CMS SignedData over the PDF's signed byte range (the `/ByteRange`), held
// in the signature dictionary's `/Contents`. The cryptography stays host-side: the firm's signing
// key is a WebCrypto CryptoKey that only ever computes a raw signature over the CMS signed
// attributes — it is never extracted and never enters the PDF engine, which treats the CMS as an
// opaque blob. This module runs anywhere WebCrypto does (the Cloudflare Worker via workerd, and
// node 22 for tests).

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

import { toArrayBuffer } from "./bytes.ts";

// CMS attribute OIDs (RFC 5652 §11; RFC 5035 for signing-certificate-v2).
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_CERTIFICATE_V2 = "1.2.840.113549.1.9.16.2.47";

export type CmsHashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

// NIST hash OIDs, for the ESSCertIDv2 hashAlgorithm when it is not the DER default (SHA-256).
const HASH_OID: Record<CmsHashAlgorithm, string> = {
  "SHA-256": "2.16.840.1.101.3.4.2.1",
  "SHA-384": "2.16.840.1.101.3.4.2.2",
  "SHA-512": "2.16.840.1.101.3.4.2.3",
};

/** Everything needed to seal one byte range. Times are caller-supplied so this stays clock-free. */
export interface DetachedCmsInput {
  /** The bytes the signature covers — the concatenated `/ByteRange` spans from the PDF engine. */
  signedBytes: Uint8Array;
  /** The firm's signing key. Kept non-extractable in the Worker; only used to sign, never exported. */
  signingKey: CryptoKey;
  /** The signer certificate, DER-encoded or already parsed. Embedded in the CMS for verification. */
  certificate: Uint8Array | pkijs.Certificate;
  /** The `signingTime` signed attribute (the CMS carries its own; the PDF dict echoes it separately). */
  signingTime: Date;
  /** The digest algorithm for the message digest and the signature. Defaults to SHA-256. */
  hashAlgorithm?: CmsHashAlgorithm;
}

let engineConfigured = false;

/** Point pkijs at the ambient WebCrypto once. Idempotent, so callers need not coordinate. */
function ensureEngine(): void {
  if (engineConfigured) return;
  const engine = new pkijs.CryptoEngine({
    name: "magna-carta-webcrypto",
    crypto: crypto as unknown as Crypto,
  });
  // pkijs 3.4's `CryptoEngine` does not declare the KEM methods its own `ICryptoEngine` lists, so
  // the type rejects it though it is exactly the engine `setEngine` expects.
  pkijs.setEngine("magna-carta-webcrypto", engine as unknown as pkijs.ICryptoEngine);
  engineConfigured = true;
}

function asCertificate(certificate: Uint8Array | pkijs.Certificate): pkijs.Certificate {
  return certificate instanceof Uint8Array
    ? pkijs.Certificate.fromBER(toArrayBuffer(certificate))
    : certificate;
}

/**
 * The ESS signing-certificate-v2 signed attribute (RFC 5035) — it binds the signature to *this*
 * certificate by a hash of its DER, closing the substitution gap the issuer-and-serial alone leaves.
 * A PAdES baseline signature requires it. pkijs has no `SigningCertificateV2` type, so the structure
 * is built directly:
 *
 *   SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
 *   ESSCertIDv2          ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier DEFAULT sha256,
 *                                       certHash OCTET STRING, issuerSerial IssuerSerial }
 *
 * DER omits a DEFAULT value, so `hashAlgorithm` is written only when it is not SHA-256.
 */
async function signingCertificateV2Attribute(
  certificate: pkijs.Certificate,
  hashAlgorithm: CmsHashAlgorithm,
): Promise<pkijs.Attribute> {
  const certificateDer = certificate.toSchema().toBER(false);
  const certHash = await crypto.subtle.digest(hashAlgorithm, certificateDer);

  const issuerSerial = new pkijs.IssuerSerial({
    issuer: new pkijs.GeneralNames({
      names: [new pkijs.GeneralName({ type: 4, value: certificate.issuer })],
    }),
    serialNumber: certificate.serialNumber,
  });

  const essCertIdV2Fields: asn1js.AsnType[] = [];
  if (hashAlgorithm !== "SHA-256") {
    essCertIdV2Fields.push(
      new pkijs.AlgorithmIdentifier({ algorithmId: HASH_OID[hashAlgorithm] }).toSchema(),
    );
  }
  essCertIdV2Fields.push(new asn1js.OctetString({ valueHex: certHash }));
  essCertIdV2Fields.push(issuerSerial.toSchema());

  const signingCertificateV2 = new asn1js.Sequence({
    value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: essCertIdV2Fields })] })],
  });

  return new pkijs.Attribute({
    type: OID_SIGNING_CERTIFICATE_V2,
    values: [signingCertificateV2],
  });
}

/**
 * Build a detached CMS SignedData over `signedBytes`, returning its DER encoding — the blob the PDF
 * engine splices into the reserved `/Contents`. The signed attributes bind the signature to the exact
 * bytes (message digest), the signer's intent time (signing time), and the content type.
 */
export async function buildDetachedCms(input: DetachedCmsInput): Promise<Uint8Array> {
  ensureEngine();
  const hashAlgorithm = input.hashAlgorithm ?? "SHA-256";
  const certificate = asCertificate(input.certificate);
  const messageDigest = await crypto.subtle.digest(hashAlgorithm, toArrayBuffer(input.signedBytes));
  const signingCertificate = await signingCertificateV2Attribute(certificate, hashAlgorithm);

  // The signed (authenticated) attributes bind the signature to the exact bytes (message digest),
  // the intent time (signing time), the content type, and — for the PAdES baseline — the signer
  // certificate itself (signing-certificate-v2). Built into the SignerInfo up front so the signer
  // is complete on construction.
  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: certificate.issuer,
      serialNumber: certificate.serialNumber,
    }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        new pkijs.Attribute({
          type: OID_CONTENT_TYPE,
          values: [new asn1js.ObjectIdentifier({ value: pkijs.ContentInfo.DATA })],
        }),
        new pkijs.Attribute({
          type: OID_SIGNING_TIME,
          values: [new asn1js.UTCTime({ valueDate: input.signingTime })],
        }),
        new pkijs.Attribute({
          type: OID_MESSAGE_DIGEST,
          values: [new asn1js.OctetString({ valueHex: messageDigest })],
        }),
        signingCertificate,
      ],
    }),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      // Detached: the content type is named but no eContent is carried — the bytes live in the PDF.
      eContentType: pkijs.ContentInfo.DATA,
    }),
    signerInfos: [signerInfo],
    certificates: [certificate],
  });

  // The message digest is already bound in the attributes, so signing covers their DER (CMS §5.4).
  await signedData.sign(input.signingKey, 0, hashAlgorithm, undefined, pkijs.getCrypto(true));

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

/**
 * Verify a detached CMS against the byte range it should cover. Returns whether the seal is intact:
 * the signature validates and the bound message digest matches `signedBytes`. A structurally broken
 * or tampered seal returns `false` rather than throwing.
 */
export async function verifyDetachedCms(
  cmsDer: Uint8Array,
  signedBytes: Uint8Array,
  trustedCertificates: pkijs.Certificate[],
): Promise<boolean> {
  ensureEngine();
  try {
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cmsDer));
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    // pkijs returns a bare boolean in some versions and a result object in others; accept both.
    const result = (await signedData.verify({
      signer: 0,
      data: toArrayBuffer(signedBytes),
      checkChain: false,
      trustedCerts: trustedCertificates,
    })) as boolean | { signatureVerified: boolean };
    return typeof result === "boolean" ? result : result.signatureVerified;
  } catch {
    // pkijs throws (e.g. "Message digest doesn't match") when the binding is broken — a rejection.
    return false;
  }
}
