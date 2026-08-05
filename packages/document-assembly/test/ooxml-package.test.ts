import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  MAX_ENTRY_COUNT,
  MAX_TEMPLATE_BYTES,
  readPackage,
  readPartText,
  writePackage,
} from "../src/ooxml/package.ts";
import { buildDocx, documentXml, paragraphOfRuns } from "./support/docx-fixture.ts";

describe("the OOXML package reader and writer", () => {
  it("reads a package to its part map", () => {
    const read = readPackage(buildDocx());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([...read.value.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/app.xml",
      "docProps/core.xml",
      "word/_rels/document.xml.rels",
      "word/document.xml",
    ]);
  });

  it("round-trips byte-stable, so the same inputs always produce the same output object", () => {
    const first = readPackage(buildDocx());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const written = writePackage(first.value);
    const second = readPackage(written);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Re-emitting an already-emitted package must be the identity — otherwise an assembly's output
    // would differ run to run for the same template version and the same merge context, and the
    // provenance record's promise that the two are explicable would be empty.
    expect(writePackage(second.value)).toEqual(written);
  });

  it("preserves part content exactly across a round trip", () => {
    const document = documentXml(paragraphOfRuns("Text with  double  spaces and a trailing one "));
    const read = readPackage(writePackage(readPackageOrThrow(buildDocx({ document }))));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(readPartText(read.value, "word/document.xml")).toBe(document);
  });

  it("refuses a package missing [Content_Types].xml as a typed failure, never a throw", () => {
    const read = readPackage(buildDocx({ omit: ["[Content_Types].xml"] }));
    expect(read).toMatchObject({ ok: false, reason: "not-a-word-package" });
  });

  it("refuses a package missing word/document.xml", () => {
    const read = readPackage(buildDocx({ omit: ["word/document.xml"] }));
    expect(read).toMatchObject({ ok: false, reason: "not-a-word-package" });
  });

  it("refuses bytes that are not an archive at all", () => {
    expect(readPackage(strToU8("this is not a zip"))).toMatchObject({
      ok: false,
      reason: "not-a-package",
    });
  });

  it("refuses an oversize package before inflating anything", () => {
    const oversize = new Uint8Array(MAX_TEMPLATE_BYTES + 1);
    expect(readPackage(oversize)).toMatchObject({ ok: false, reason: "oversize" });
  });

  it("refuses an archive with more entries than the cap", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index <= MAX_ENTRY_COUNT; index += 1) {
      entries[`word/media/image${index}.bin`] = strToU8("x");
    }
    expect(readPackage(zipSync(entries))).toMatchObject({
      ok: false,
      reason: "decompression-bomb",
    });
  });

  it("refuses a bomb-shaped archive whose entries inflate past the cap", () => {
    // A highly compressible payload: small on disk, enormous inflated — the shape that would exhaust
    // the isolate before any check downstream of inflation could fire.
    const payload = new Uint8Array(9 * 1024 * 1024); // zero-filled, so it compresses to almost nothing
    const bomb = zipSync({
      "[Content_Types].xml": payload,
      "word/document.xml": payload,
      "word/styles.xml": payload,
    });
    expect(bomb.byteLength).toBeLessThan(MAX_TEMPLATE_BYTES);
    expect(readPackage(bomb)).toMatchObject({ ok: false, reason: "decompression-bomb" });
  });
});

function readPackageOrThrow(bytes: Uint8Array) {
  const read = readPackage(bytes);
  if (!read.ok) throw new Error(`fixture package unreadable: ${read.reason}`);
  return read.value;
}
