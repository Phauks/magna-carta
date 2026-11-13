// Runs in the Cloudflare pool (workerd) — so this both verifies the sign worker's behavior and
// proves the pure-Rust PDF WASM loads and runs in the real Worker runtime, sealing a document end to
// end (prepare/embed in WASM, CMS via pkijs, all in workerd).

import { extractPdfText } from "@magna-carta/pdf";
import composeWasmModule from "@magna-carta/pdf-compose/src/pkg/pdf_compose_core_bg.wasm";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";
import {
  encodeSealRequest,
  fromBase64,
  toBase64,
  verifyDetachedCms,
  type SealRequest,
  type SignerCompletion,
} from "@magna-carta/signing";
import { decodeSealResponse } from "@magna-carta/signing/port";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src/index.ts";
import { performSeal } from "../src/seal-service.ts";
import { HELLO_PDF_BASE64 } from "./fixtures.ts";

const engines = {
  pdf: pdfWasmModule,
  compose: composeWasmModule,
};
const helloPdf = fromBase64(HELLO_PDF_BASE64);

const signer: SignerCompletion = {
  intent: { signerId: "usr_seal_initiator", adoption: "typed", affirmedAt: "2026-07-18T12:00:00Z" },
  consent: { disclosureVersion: "v1", consentedAt: "2026-07-18T11:59:00Z" },
  attribution: { level: "firm-authenticated" },
};

interface PlatformMaterial {
  privateKey: CryptoKey;
  certificate: pkijs.Certificate;
  pkcs8Base64: string;
  certDerBase64: string;
}

async function generatePlatformMaterial(): Promise<PlatformMaterial> {
  const engine = new pkijs.CryptoEngine({
    name: "sign-worker-test",
    crypto: crypto as unknown as Crypto,
  });
  pkijs.setEngine("sign-worker-test", engine as unknown as pkijs.ICryptoEngine);
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as { privateKey: CryptoKey; publicKey: CryptoKey };

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  const cn = new pkijs.AttributeTypeAndValue({
    type: "2.5.4.3",
    value: new asn1js.Utf8String({ value: "Magna Carta Platform Seal" }),
  });
  certificate.issuer.typesAndValues.push(cn);
  certificate.subject.typesAndValues.push(cn);
  certificate.notBefore.value = new Date("2026-01-01T00:00:00Z");
  certificate.notAfter.value = new Date("2036-01-01T00:00:00Z");
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, pkijs.getCrypto(true));
  await certificate.sign(keys.privateKey, "SHA-256", pkijs.getCrypto(true));

  // workerd's SubtleCrypto declares one `exportKey` returning `ArrayBuffer | JsonWebKey`; the format
  // argument decides which, and "pkcs8" is always the ArrayBuffer branch. (lib.dom splits that into
  // per-format overloads, which is why the same call needs no narrowing in a node-typed package —
  // packages/signing/src/platform-certificate.ts makes it verbatim.)
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer,
  );
  const certDer = new Uint8Array(certificate.toSchema().toBER(false));
  return {
    privateKey: keys.privateKey,
    certificate,
    pkcs8Base64: toBase64(pkcs8),
    certDerBase64: toBase64(certDer),
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Pull the sealed byte range and embedded CMS out of a sealed PDF for verification. */
async function verifySealedCms(sealed: Uint8Array, cert: pkijs.Certificate): Promise<boolean> {
  const text = new TextDecoder("latin1").decode(sealed);
  const match = text.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (match === null) return false;
  const gapStart = Number(match[2]);
  const gapEnd = Number(match[3]);
  const suffixLen = Number(match[4]);
  const signed = concat(sealed.subarray(0, gapStart), sealed.subarray(gapEnd, gapEnd + suffixLen));
  const hex = new TextDecoder().decode(sealed.subarray(gapStart + 1, gapEnd - 1));
  const cmsDer = Uint8Array.from(hex.match(/../g)!.map((byte) => parseInt(byte, 16)));
  return verifyDetachedCms(cmsDer, signed, [cert]);
}

function sealRequest(): SealRequest {
  return {
    document: helloPdf,
    signers: [signer],
    signingTime: "2026-07-18T12:00:01Z",
    seal: { reason: "Engagement letter", name: "Magna Carta Platform Seal" },
  };
}

describe("sign worker — platform seal on workerd", () => {
  let material: PlatformMaterial;
  beforeAll(async () => {
    material = await generatePlatformMaterial();
  });

  it("performSeal seals a real PDF whose CMS verifies (WASM engine runs in workerd)", async () => {
    const response = await performSeal(
      sealRequest(),
      { signingKey: material.privateKey, certificate: fromBase64(material.certDerBase64) },
      engines,
    );

    expect(response.sealedPdf.subarray(0, helloPdf.length)).toEqual(helloPdf);
    expect(response.documentHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(response.certificateText).toContain("CERTIFICATE OF COMPLETION");
    expect(response.certificate.signers).toHaveLength(1);
    expect(await verifySealedCms(response.sealedPdf, material.certificate)).toBe(true);
  });

  it("issues the certificate as a sealed PDF that prints the request and its audit log", async () => {
    const response = await performSeal(
      {
        ...sealRequest(),
        signers: [
          {
            intent: { ...signer.intent, name: "Alice Example", email: "alice@example.test" },
            consent: signer.consent,
            attribution: { level: "access-code", observedIp: "198.51.100.7" },
          },
        ],
        envelope: { id: "env_0001", title: "Engagement letter.pdf" },
        events: [
          { kind: "sent", at: "2026-07-18T11:50:00Z", actor: "Bob Sender" },
          { kind: "viewed", at: "2026-07-18T11:58:00Z", actor: "Alice Example" },
        ],
      },
      { signingKey: material.privateKey, certificate: fromBase64(material.certDerBase64) },
      engines,
    );

    // The page count comes from the document that was sealed, not from the caller.
    expect(response.certificate.envelope).toEqual({
      id: "env_0001",
      title: "Engagement letter.pdf",
      pageCount: 1,
    });
    expect(response.certificate.events?.map((event) => event.kind)).toEqual([
      "sent",
      "viewed",
      "consented",
      "signed",
      "sealed",
    ]);

    // The sheet is a PDF, it carries the platform seal, and a reader finds the record on it.
    expect(new TextDecoder().decode(response.certificatePdf.subarray(0, 5))).toBe("%PDF-");
    expect(await verifySealedCms(response.certificatePdf, material.certificate)).toBe(true);
    const printed = (await extractPdfText(response.certificatePdf)).pages
      .flatMap((page) => page.lines.map((line) => line.text))
      .join("\n");
    expect(printed).toContain("Certificate of Completion");
    expect(printed).toContain(response.certificate.reference);
    expect(response.certificate.reference).toMatch(/^MC-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(printed).not.toContain("env_0001");
    expect(printed).toContain("Alice Example");
    expect(printed).toContain("198.51.100.7");
    expect(printed).toContain("Sent for Signature");
    expect(printed).toContain(response.documentHashSha256.slice(0, 32));
  });

  it("POST /seal returns a sealed, verifiable document when configured", async () => {
    const env = {
      PLATFORM_SEAL_KEY: material.pkcs8Base64,
      PLATFORM_SEAL_CERT: material.certDerBase64,
    };
    const res = await worker.fetch(
      new Request("https://sign/seal", { method: "POST", body: encodeSealRequest(sealRequest()) }),
      env,
    );
    expect(res.status).toBe(200);

    const response = decodeSealResponse(await res.text());
    expect(response.sealedPdf.subarray(0, helloPdf.length)).toEqual(helloPdf);
    expect(await verifySealedCms(response.sealedPdf, material.certificate)).toBe(true);
    expect(await verifySealedCms(response.certificatePdf, material.certificate)).toBe(true);
  });

  it("returns 503 seal-not-configured when the platform secrets are absent", async () => {
    const res = await worker.fetch(
      new Request("https://sign/seal", { method: "POST", body: encodeSealRequest(sealRequest()) }),
      {},
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "seal-not-configured" });
  });

  it("returns 404 for anything but POST /seal", async () => {
    const res = await worker.fetch(new Request("https://sign/other"), {});
    expect(res.status).toBe(404);
  });
});
