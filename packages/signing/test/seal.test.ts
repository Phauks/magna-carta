import { describe, expect, it } from "vitest";

import { verifyDetachedCms } from "../src/cms.ts";
import type { PreparedSeal, SealEngine } from "../src/engine.ts";
import { sealDocument } from "../src/seal.ts";
import { generateSigningIdentity } from "./helpers.ts";

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}

/**
 * An in-memory SealEngine that honors the pdf-core contract faithfully: the input is preserved as a
 * prefix, `/Contents` is a reserved run of `0` between `<` and `>`, the `/ByteRange` excludes exactly
 * that gap, and embed splices the CMS hex at the head of the gap. It records the CMS it received so
 * the orchestration can be asserted exactly.
 */
function fakeEngine(): { engine: SealEngine; embeddedCms: () => Uint8Array } {
  const encoder = new TextEncoder();
  let lastCms: Uint8Array = new Uint8Array();

  const engine: SealEngine = {
    async prepare(pdf, options) {
      const capacity = options.contentsCapacity ?? 4096;
      const separator =
        pdf.length > 0 && pdf[pdf.length - 1] === 0x0a ? new Uint8Array() : encoder.encode("\n");
      const head = concat(
        pdf,
        separator,
        encoder.encode(`999 0 obj\n<< /Type /Sig /M (${options.signingTime ?? ""}) /Contents `),
      );
      const gapStart = head.length; // where '<' goes
      const zeros = new Uint8Array(capacity * 2).fill(0x30); // '0'
      const document = concat(
        head,
        encoder.encode("<"),
        zeros,
        encoder.encode(">"),
        encoder.encode(" >>\nendobj\n"),
      );
      const gapEnd = gapStart + 1 + capacity * 2 + 1; // just past '>'
      const prepared: PreparedSeal = {
        document,
        byteRange: [0, gapStart, gapEnd, document.length - gapEnd],
        contentsSpan: [gapStart + 1, gapEnd - 1],
      };
      return prepared;
    },
    signedBytes(prepared) {
      const [, gapStart, gapEnd, suffixLength] = prepared.byteRange;
      return concat(
        prepared.document.slice(0, gapStart),
        prepared.document.slice(gapEnd, gapEnd + suffixLength),
      );
    },
    async embed(prepared, cmsDer) {
      lastCms = cmsDer;
      const out = prepared.document.slice();
      const [start] = prepared.contentsSpan;
      out.set(encoder.encode(toHex(cmsDer)), start);
      return out;
    },
  };

  return { engine, embeddedCms: () => lastCms };
}

describe("sealDocument", () => {
  it("prepares, signs host-side, and embeds a verifiable seal without disturbing the input", async () => {
    const { keys, certificate } = await generateSigningIdentity();
    const pdf = new TextEncoder().encode("%PDF-1.7 original document body\n%%EOF\n");
    const { engine, embeddedCms } = fakeEngine();

    const result = await sealDocument({
      pdf,
      engine,
      signingKey: keys.privateKey,
      certificate,
      signingTime: new Date("2026-07-18T12:00:00Z"),
      seal: { reason: "Engagement letter", name: "Magna Carta Platform Seal" },
    });

    // The input survives as a literal prefix of the sealed output.
    expect(result.sealedPdf.slice(0, pdf.length)).toEqual(pdf);

    // The reported /ByteRange excludes the /Contents gap and reaches EOF.
    const [start, gapStart, gapEnd, suffixLength] = result.byteRange;
    expect(start).toBe(0);
    expect(gapEnd).toBeGreaterThan(gapStart);
    expect(gapEnd + suffixLength).toBe(result.sealedPdf.length);

    // The CMS the engine embedded verifies against the exact bytes the range covers.
    const signed = concat(
      result.sealedPdf.slice(0, gapStart),
      result.sealedPdf.slice(gapEnd, gapEnd + suffixLength),
    );
    expect(await verifyDetachedCms(embeddedCms(), signed, [certificate])).toBe(true);

    // The document hash the Certificate of Completion binds to is SHA-256 of that same range.
    const expected = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", signed))).toLowerCase();
    expect(result.documentHashSha256).toBe(expected);
  });
});
