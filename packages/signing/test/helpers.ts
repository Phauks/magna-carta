// Shared test fixtures: a throwaway signing identity (key pair + self-signed certificate) standing
// in for the pre-provisioned platform seal certificate.

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/** A WebCrypto key pair. `CryptoKeyPair` is not a global under the `node` lib set, so name it here. */
export interface SigningKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export interface SigningIdentity {
  keys: SigningKeyPair;
  certificate: pkijs.Certificate;
}

const SIGN_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const;

function commonName(value: string): pkijs.AttributeTypeAndValue {
  return new pkijs.AttributeTypeAndValue({
    type: "2.5.4.3",
    value: new asn1js.Utf8String({ value }),
  });
}

export async function generateSigningIdentity(): Promise<SigningIdentity> {
  const engine = new pkijs.CryptoEngine({ name: "signing-test", crypto: crypto as unknown as Crypto });
  pkijs.setEngine("signing-test", engine as unknown as pkijs.ICryptoEngine);
  const keys = (await crypto.subtle.generateKey(SIGN_ALGORITHM, true, [
    "sign",
    "verify",
  ])) as SigningKeyPair;

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  certificate.issuer.typesAndValues.push(commonName("Magna Carta Platform Seal (test)"));
  certificate.subject.typesAndValues.push(commonName("Magna Carta Platform Seal (test)"));
  certificate.notBefore.value = new Date("2026-01-01T00:00:00Z");
  certificate.notAfter.value = new Date("2036-01-01T00:00:00Z");
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, pkijs.getCrypto(true));
  await certificate.sign(keys.privateKey, "SHA-256", pkijs.getCrypto(true));
  return { keys, certificate };
}
