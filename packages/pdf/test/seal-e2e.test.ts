// End-to-end proof that the two halves of the PAdES seal compose for real: the pure-Rust engine
// (WASM) owns the PDF structure, and @magna-carta/signing produces the CMS host-side. This drives a
// real PDF through prepare (WASM) -> sign the byte range (WebCrypto/pkijs) -> embed (WASM) and
// confirms the sealed document verifies — the whole flow, no fakes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDetachedCms, sealDocument, verifyDetachedCms } from "@magna-carta/signing";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { beforeAll, describe, expect, it } from "vitest";

import { createSealEngine, ensureReady, extractPdfText, PdfDocument } from "../src/index.js";

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url)),
);
const helloPdf = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

async function signingIdentity(): Promise<{ keys: KeyPair; certificate: pkijs.Certificate }> {
  const engine = new pkijs.CryptoEngine({ name: "e2e", crypto: crypto as unknown as Crypto });
  pkijs.setEngine("e2e", engine as unknown as pkijs.ICryptoEngine);
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
    value: new asn1js.Utf8String({ value: "Magna Carta Platform Seal (e2e)" }),
  });
  certificate.issuer.typesAndValues.push(cn);
  certificate.subject.typesAndValues.push(cn);
  certificate.notBefore.value = new Date("2026-01-01T00:00:00Z");
  certificate.notAfter.value = new Date("2036-01-01T00:00:00Z");
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, pkijs.getCrypto(true));
  await certificate.sign(keys.privateKey, "SHA-256", pkijs.getCrypto(true));
  return { keys, certificate };
}

describe("PAdES seal end to end (WASM engine + pkijs CMS)", () => {
  beforeAll(async () => {
    await ensureReady(wasmBytes);
  });

  it("seals a real PDF and the embedded CMS verifies against the byte range", async () => {
    const { keys, certificate } = await signingIdentity();
    const engine = createSealEngine(wasmBytes);

    const result = await sealDocument({
      pdf: helloPdf,
      engine,
      signingKey: keys.privateKey,
      certificate,
      signingTime: new Date("2026-07-18T12:00:00Z"),
      seal: { reason: "Engagement letter", name: "Magna Carta Platform Seal" },
    });

    // The original bytes are preserved as the prefix of the sealed document.
    expect(result.sealedPdf.slice(0, helloPdf.length)).toEqual(helloPdf);

    // The sealed PDF still parses through the render engine (hayro), signature and all.
    const doc = await PdfDocument.load(result.sealedPdf, wasmBytes);
    expect(doc.pageCount).toBeGreaterThan(0);
    doc.free();

    // Recompute the signed byte range from the sealed document and verify the embedded CMS.
    const [, gapStart, gapEnd, suffixLength] = result.byteRange;
    const signed = new Uint8Array(gapStart + suffixLength);
    signed.set(result.sealedPdf.subarray(0, gapStart), 0);
    signed.set(result.sealedPdf.subarray(gapEnd, gapEnd + suffixLength), gapStart);

    const cmsHex = new TextDecoder().decode(result.sealedPdf.subarray(gapStart + 1, gapEnd - 1));
    const cmsDer = Uint8Array.from(cmsHex.match(/../g)!.map((byte) => parseInt(byte, 16)));

    expect(await verifyDetachedCms(cmsDer, signed, [certificate])).toBe(true);
  });

  it("draws a visible signature on the page and refuses a page the document does not have", async () => {
    const engine = createSealEngine(wasmBytes);
    const lines = ["Signed by José Álvarez", "2026-11-10 14:02 UTC"];
    const prepared = await engine.prepare(helloPdf, {
      name: "José Álvarez",
      appearance: { page: 0, rect: [72, 72, 272, 112], lines },
    });

    // Still an incremental update, and the box's text is on the page for a reader to see.
    expect(prepared.document.slice(0, helloPdf.length)).toEqual(helloPdf);
    const text = await extractPdfText(prepared.document);
    const pageText = text.pages[0]!.lines.map((line) => line.text).join("\n");
    for (const line of lines) {
      expect(pageText).toContain(line);
    }

    await expect(
      engine.prepare(helloPdf, { appearance: { page: 9, rect: [72, 72, 272, 112], lines } }),
    ).rejects.toThrow("page index out of range");
    await expect(
      engine.prepare(helloPdf, { appearance: { page: 0, rect: [72, 72, 72, 112], lines } }),
    ).rejects.toThrow("the signature box has no usable size");
  });

  it("rebuilding a CMS over tampered bytes does not verify against the sealed range", async () => {
    const { keys, certificate } = await signingIdentity();
    const engine = createSealEngine(wasmBytes);
    const prepared = await engine.prepare(helloPdf, { reason: "x" });
    const signed = engine.signedBytes(prepared);

    const goodCms = await buildDetachedCms({
      signedBytes: signed,
      signingKey: keys.privateKey,
      certificate,
      signingTime: new Date("2026-07-18T12:00:00Z"),
    });
    expect(await verifyDetachedCms(goodCms, signed, [certificate])).toBe(true);

    const tampered = signed.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(await verifyDetachedCms(goodCms, tampered, [certificate])).toBe(false);
  });
});
