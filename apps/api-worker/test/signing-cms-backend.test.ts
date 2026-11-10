// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// Runtime-compatibility guard: the @magna-carta/signing CMS layer must run on the real Workers
// runtime (workerd, via @cloudflare/vitest-plugin), not only under node. The CMS logic and its
// thorough coverage live in the package's own tests; this proves the same code seals and verifies on
// workerd's WebCrypto, so the platform seal works where it actually runs.

import { buildDetachedCms, verifyDetachedCms } from "@magna-carta/signing";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";

interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

async function selfSignedIdentity() {
  const engine = new pkijs.CryptoEngine({
    name: "workerd-webcrypto",
    crypto: crypto as unknown as Crypto,
  });
  pkijs.setEngine("workerd-webcrypto", engine as unknown as pkijs.ICryptoEngine);
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as KeyPair;
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  const cn = new pkijs.AttributeTypeAndValue({
    type: "2.5.4.3",
    value: new asn1js.Utf8String({ value: "Magna Carta Platform Seal (test)" }),
  });
  certificate.issuer.typesAndValues.push(cn);
  certificate.subject.typesAndValues.push(cn);
  certificate.notBefore.value = new Date("2026-01-01T00:00:00Z");
  certificate.notAfter.value = new Date("2036-01-01T00:00:00Z");
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, pkijs.getCrypto(true));
  await certificate.sign(keys.privateKey, "SHA-256", pkijs.getCrypto(true));
  return { keys, certificate };
}

describe("@magna-carta/signing CMS on workerd", () => {
  it("seals and verifies a byte range, and rejects a tampered one", async () => {
    const { keys, certificate } = await selfSignedIdentity();
    const signedBytes = new TextEncoder().encode("%PDF-1.7 byte range for the workerd seal check");

    const cms = await buildDetachedCms({
      signedBytes,
      signingKey: keys.privateKey,
      certificate,
      signingTime: new Date("2026-07-18T12:00:00Z"),
    });

    expect(cms.byteLength).toBeGreaterThan(0);
    expect(cms.byteLength).toBeLessThan(16 * 1024);
    expect(await verifyDetachedCms(cms, signedBytes, [certificate])).toBe(true);
    expect(await verifyDetachedCms(cms, new TextEncoder().encode("tampered!"), [certificate])).toBe(
      false,
    );
  });
});
