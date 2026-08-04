// Generating the platform seal identity — the signing key and self-signed certificate the seal is
// applied with.
//
// The platform seal is not a per-signer PKI credential and makes no claim about who signed: it is
// Magna Carta's own tamper-evidence mark on a completed record, so the identity is one self-signed
// certificate the platform holds, not a credential issued by a public CA. A PDF validator will
// therefore report the signature as cryptographically intact but the signer as untrusted until the
// certificate is distributed as a trust anchor — that is the intended posture, and the reason the
// certificate's fingerprint is part of the generated material (it is what gets published).
//
// The key is generated **extractable** here and nowhere else: provisioning has to hand the PKCS#8
// bytes to the secret store once. The sign worker re-imports it non-extractable, so the only moment
// the private key exists in a readable form is this function's return value — treat it accordingly
// (write it straight to the secret store, never to a log, a transcript, or shared storage).

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

import { toArrayBuffer, toBase64 } from "./bytes.ts";
import { ensureEngine } from "./webcrypto-engine.ts";

// X.509 v3 extension OIDs (RFC 5280).
const OID_SUBJECT_KEY_IDENTIFIER = "2.5.29.14";
const OID_KEY_USAGE = "2.5.29.15";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_EXTENDED_KEY_USAGE = "2.5.29.37";
// id-kp-documentSigning (RFC 9336) — the key purpose for a certificate that signs documents, as
// opposed to authenticating a server or a person. Names the certificate's role to a validator.
const OID_KEY_PURPOSE_DOCUMENT_SIGNING = "1.3.6.1.5.5.7.3.36";
// Distinguished-name attribute types (X.520).
const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION_NAME = "2.5.4.10";
const OID_COUNTRY_NAME = "2.5.4.6";

// X.509 v3. The field is zero-based, so v3 is the value 2.
const X509_VERSION_3 = 2;

/** What the generated identity should say and how long it should live. */
export interface PlatformSealIdentityOptions {
  /** The certificate's common name — what a PDF viewer shows as the signer. */
  readonly commonName: string;
  /** The organization the seal belongs to. */
  readonly organizationName?: string;
  /** Two-letter ISO country code. */
  readonly countryName?: string;
  /** Validity start. Caller-supplied so this stays clock-free, like the rest of the package. */
  readonly notBefore: Date;
  /** Validity end. A platform seal is long-lived — the certificate outliving the documents it
   *  sealed is what keeps them verifiable without a timestamp authority. */
  readonly notAfter: Date;
  /** RSA modulus size. Defaults to 3072 — a decade-long identity warrants more than the 2048
   *  minimum, and every PDF validator that matters accepts it. */
  readonly modulusLength?: number;
  /** Overrides the random serial number. Provided for deterministic tests only. */
  readonly serialNumber?: Uint8Array;
}

/** The generated identity: the two secret values, plus the public material to publish. */
export interface PlatformSealIdentity {
  /** The PKCS#8 private key, base64 — the `PLATFORM_SEAL_KEY` secret. Secret material. */
  readonly privateKeyPkcs8Base64: string;
  /** The DER certificate, base64 — the `PLATFORM_SEAL_CERT` secret. Public, but paired with the key. */
  readonly certificateDerBase64: string;
  /** The certificate in PEM, for distribution to validators and counsel. Public. */
  readonly certificatePem: string;
  /** Lowercase hex SHA-256 over the DER certificate — the fingerprint to publish and verify against. */
  readonly certificateFingerprintSha256: string;
  /** The certificate's serial number, lowercase hex. */
  readonly serialNumberHex: string;
  /** Validity window, ISO 8601, echoed back for the provisioning record. */
  readonly notBefore: string;
  readonly notAfter: string;
}

function attribute(type: string, value: string): pkijs.AttributeTypeAndValue {
  // X.520 defines countryName as a PrintableString of exactly two characters; every other attribute
  // here is a UTF8String. Encoding the country as UTF8String is a deviation some validators flag.
  const encoded =
    type === OID_COUNTRY_NAME
      ? new asn1js.PrintableString({ value })
      : new asn1js.Utf8String({ value });
  return new pkijs.AttributeTypeAndValue({ type, value: encoded });
}

/**
 * Build a distinguished name as a proper RDNSequence — one relative distinguished name per
 * attribute. pkijs's default encoding puts every attribute into a single SET, which is the legal
 * but unusual multi-valued form that renders as `CN = ... + O = ...` and that some validators and
 * name-comparison routines handle poorly. Building the DER here and handing it over through
 * `valueBeforeDecode` is the supported way to override: pkijs emits that buffer verbatim.
 */
function distinguishedName(
  parts: readonly (readonly [string, string])[],
): pkijs.RelativeDistinguishedNames {
  const typesAndValues = parts.map(([type, value]) => attribute(type, value));
  const name = new pkijs.RelativeDistinguishedNames({ typesAndValues });
  name.valueBeforeDecode = new asn1js.Sequence({
    value: typesAndValues.map((part) => new asn1js.Set({ value: [part.toSchema()] })),
  }).toBER(false);
  return name;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// A random, positive, non-zero serial number (RFC 5280 requires a positive INTEGER; a predictable
// serial is a known weakness in certificate issuance). The top bit is cleared so the DER INTEGER is
// unambiguously positive, and the first byte is forced non-zero so the value is never left-padded.
function randomSerialNumber(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = ((bytes[0] ?? 0) & 0x7f) | 0x01;
  return bytes;
}

// The subject key identifier, RFC 7093 method 1: the leftmost 160 bits of the SHA-256 digest over
// the public key BIT STRING value. RFC 5280's original method uses SHA-1; RFC 7093 defines these
// SHA-2 alternatives precisely so a modern certificate need not carry a SHA-1 computation at all.
async function subjectKeyIdentifier(publicKeyBits: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(publicKeyBits)),
  );
  return digest.subarray(0, 20);
}

function extension(extnID: string, critical: boolean, value: asn1js.AsnType): pkijs.Extension {
  return new pkijs.Extension({
    extnID,
    critical,
    extnValue: value.toBER(false),
    parsedValue: value,
  });
}

/** PEM-wrap DER bytes at the conventional 64 characters per line. */
function toPem(der: Uint8Array, label: string): string {
  const body = toBase64(der).replace(/.{1,64}/g, "$&\n");
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
}

/**
 * Generate the platform seal identity: an RSA signing key and a self-signed X.509 v3 certificate
 * carrying the extensions a document-signing certificate is expected to have — `basicConstraints`
 * (not a CA), `keyUsage` restricted to digitalSignature + contentCommitment, `extendedKeyUsage` of
 * id-kp-documentSigning, and a subject key identifier.
 *
 * Returns both secret values base64-encoded, ready to be written to the sign worker's
 * `PLATFORM_SEAL_KEY` and `PLATFORM_SEAL_CERT` secrets, plus the public certificate and fingerprint.
 */
export async function generatePlatformSealIdentity(
  options: PlatformSealIdentityOptions,
): Promise<PlatformSealIdentity> {
  if (options.notAfter <= options.notBefore) {
    throw new RangeError("The certificate's notAfter must be later than its notBefore.");
  }
  ensureEngine();

  // Extractable exactly once, here: provisioning must export the PKCS#8 bytes to hand them to the
  // secret store. Every consumer re-imports the key non-extractable.
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: options.modulusLength ?? 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as { privateKey: CryptoKey; publicKey: CryptoKey };

  const certificate = new pkijs.Certificate();
  certificate.version = X509_VERSION_3;
  const serialNumber = options.serialNumber ?? randomSerialNumber();
  certificate.serialNumber = new asn1js.Integer({ valueHex: toArrayBuffer(serialNumber) });

  // Self-signed: the issuer and the subject are the same name.
  const nameParts: (readonly [string, string])[] = [[OID_COMMON_NAME, options.commonName]];
  if (options.organizationName !== undefined) {
    nameParts.push([OID_ORGANIZATION_NAME, options.organizationName]);
  }
  if (options.countryName !== undefined) {
    nameParts.push([OID_COUNTRY_NAME, options.countryName]);
  }
  certificate.issuer = distinguishedName(nameParts);
  certificate.subject = distinguishedName(nameParts);

  certificate.notBefore.value = options.notBefore;
  certificate.notAfter.value = options.notAfter;
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, pkijs.getCrypto(true));

  const basicConstraints = new pkijs.BasicConstraints({ cA: false });
  // KeyUsage is a DER BIT STRING whose bit 0 is the most significant bit of the first octet:
  // digitalSignature (bit 0) and contentCommitment/nonRepudiation (bit 1) set is 0b1100_0000, with
  // the remaining six bits unused. Restricting the key here is what stops this identity from being
  // usable for anything but signing.
  const keyUsage = new asn1js.BitString({
    unusedBits: 6,
    valueHex: toArrayBuffer(new Uint8Array([0b1100_0000])),
  });
  const extendedKeyUsage = new pkijs.ExtKeyUsage({
    keyPurposes: [OID_KEY_PURPOSE_DOCUMENT_SIGNING],
  });
  const keyIdentifier = new asn1js.OctetString({
    valueHex: toArrayBuffer(
      await subjectKeyIdentifier(
        new Uint8Array(certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView),
      ),
    ),
  });

  certificate.extensions = [
    extension(OID_BASIC_CONSTRAINTS, true, basicConstraints.toSchema()),
    extension(OID_KEY_USAGE, true, keyUsage),
    extension(OID_EXTENDED_KEY_USAGE, false, extendedKeyUsage.toSchema()),
    extension(OID_SUBJECT_KEY_IDENTIFIER, false, keyIdentifier),
  ];

  await certificate.sign(keys.privateKey, "SHA-256", pkijs.getCrypto(true));

  const certificateDer = new Uint8Array(certificate.toSchema().toBER(false));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const fingerprint = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(certificateDer)),
  );

  return {
    privateKeyPkcs8Base64: toBase64(privateKeyPkcs8),
    certificateDerBase64: toBase64(certificateDer),
    certificatePem: toPem(certificateDer, "CERTIFICATE"),
    certificateFingerprintSha256: toHex(fingerprint),
    serialNumberHex: toHex(serialNumber),
    notBefore: options.notBefore.toISOString(),
    notAfter: options.notAfter.toISOString(),
  };
}
