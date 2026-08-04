import { describe, expect, it } from "vitest";
import { macroResidue } from "../src/macros.ts";
import { readPackage, readPartText } from "../src/ooxml/package.ts";
import { prepareTemplateVersion, type TemplateScrub } from "../src/register.ts";
import {
  buildDocx,
  complexMergeFieldParagraph,
  documentXml,
  MAIN_DOCUMENT_CONTENT_TYPE,
  paragraphOfRuns,
  VBA_PROJECT_BYTES,
  type DocxParts,
} from "./support/docx-fixture.ts";

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const CONTENT_TYPES_HEADER =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
const RELATIONSHIPS_HEADER =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

// A scrub that returns its input untouched. The real metadata scrub is a separate engine with its own
// tests; what this pipeline has to prove is the ORDER — strip, normalize, scrub, then re-verify the
// bytes that will actually be stored.
const passThroughScrub: TemplateScrub = (bytes) => Promise.resolve(bytes);

const failingScrub: TemplateScrub = () => Promise.resolve(undefined);

function macroBearingTemplate(): DocxParts {
  return {
    contentTypes:
      `${DECLARATION}${CONTENT_TYPES_HEADER}` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>' +
      "</Types>",
    documentRels:
      `${DECLARATION}${RELATIONSHIPS_HEADER}` +
      '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' +
      "</Relationships>",
    document: documentXml(paragraphOfRuns("Letter for {{client.disp", "layName}}.")),
    extra: { "word/vbaProject.bin": VBA_PROJECT_BYTES },
  };
}

describe("the template registration pipeline", () => {
  it("prepares an ordinary template, normalizing it and recording its manifest", async () => {
    const result = await prepareTemplateVersion(
      buildDocx({
        document: documentXml(paragraphOfRuns("Matter {{matter.", "number}} for {{firm.name}}")),
      }),
      passThroughScrub,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preparation.manifest.fields.map((field) => field.key)).toEqual([
      "firm.name",
      "matter.number",
    ]);
    expect(result.preparation.removedMacroParts).toEqual([]);
    expect(result.preparation.normalizerVersion).toBeGreaterThanOrEqual(1);
  });

  it("ACCEPTS a macro-bearing template, strips the payload, and stores clean bytes", async () => {
    // A firm migrating from an older system has macro templates and will ask us to take them. The
    // resolution is to accept and strip rather than refuse — but only after the stripped package is
    // re-verified as clean.
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      passThroughScrub,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preparation.removedMacroParts).toEqual(["word/vbaProject.bin"]);

    const stored = readPackage(result.preparation.bytes);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.has("word/vbaProject.bin")).toBe(false);
    expect(macroResidue(stored.value)).toEqual([]);
    // The main document is no longer declared macro-enabled, so no reader will offer to run macros
    // from a template that no longer has any.
    const contentTypes = readPartText(stored.value, "[Content_Types].xml") ?? "";
    expect(contentTypes).not.toContain("macroEnabled");
    expect(contentTypes).toContain(MAIN_DOCUMENT_CONTENT_TYPE);
    // And the template still works: its placeholder survived the strip and was normalized.
    expect(result.preparation.manifest.fields.map((field) => field.key)).toEqual([
      "client.displayName",
    ]);
  });

  it("REFUSES registration when a macro survives into the bytes that would be stored", async () => {
    // The gate is on the FINAL bytes, so a scrub step that re-introduced a macro payload — or a
    // stripper that missed one — stops registration rather than being taken on trust.
    const reintroducingScrub: TemplateScrub = async (bytes) => {
      const read = readPackage(bytes);
      if (!read.ok) return undefined;
      read.value.set("word/vbaProject.bin", VBA_PROJECT_BYTES);
      const { writePackage } = await import("../src/ooxml/package.ts");
      return writePackage(read.value);
    };
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      reintroducingScrub,
    );
    expect(result).toMatchObject({ ok: false, reason: "macro-residue" });
    if (result.ok) return;
    expect(result.macroFindings).toContainEqual({ kind: "part", detail: "word/vbaProject.bin" });
  });

  it("REFUSES a package that claims to be a document but is not a readable one", async () => {
    const result = await prepareTemplateVersion(
      buildDocx({ omit: ["word/document.xml"] }),
      passThroughScrub,
    );
    expect(result).toMatchObject({ ok: false, reason: "not-a-word-package" });
  });

  it("REFUSES a template with an authoring mistake, carrying the location", async () => {
    const result = await prepareTemplateVersion(
      buildDocx({ document: documentXml(paragraphOfRuns("Matter {{matter.numbre}}")) }),
      passThroughScrub,
    );
    expect(result).toMatchObject({ ok: false, reason: "normalization-failed" });
    if (result.ok) return;
    expect(result.normalizationFailures[0]).toMatchObject({
      code: "unknown-key",
      part: "word/document.xml",
    });
  });

  it("REFUSES a template whose drafting history could not be removed", async () => {
    const result = await prepareTemplateVersion(buildDocx({}), failingScrub);
    expect(result).toMatchObject({ ok: false, reason: "scrub-failed" });
  });

  it("survives a scrub that throws, reporting it as a scrub failure rather than escaping", async () => {
    const throwingScrub: TemplateScrub = () => {
      throw new Error("engine unavailable");
    };
    const result = await prepareTemplateVersion(buildDocx({}), throwingScrub);
    expect(result).toMatchObject({ ok: false, reason: "scrub-failed" });
  });

  it("REFUSES a merge-field template by default, reporting what it found and what to do about it", async () => {
    // Conversion is opt-in: the firm's own document is never rewritten without being asked, and a
    // refusal that names the fields is what lets a caller offer the choice.
    const result = await prepareTemplateVersion(
      buildDocx({ document: documentXml(complexMergeFieldParagraph("matter.number")) }),
      passThroughScrub,
    );
    expect(result).toMatchObject({ ok: false, reason: "normalization-failed" });
    if (result.ok) return;
    expect(result.normalizationFailures[0]).toMatchObject({
      code: "merge-field-conversion-required",
    });
    expect(result.mergeFieldDetections).toEqual([
      {
        fieldName: "matter.number",
        mappedKey: "matter.number",
        part: "word/document.xml",
        occurrences: 1,
        form: "complex",
        mapsToKnownField: true,
      },
    ]);
  });

  it("converts Word merge fields when the caller opts in, so the stored version carries one form", async () => {
    const result = await prepareTemplateVersion(
      buildDocx({ document: documentXml(complexMergeFieldParagraph("matter.number")) }),
      passThroughScrub,
      { convertMergeFields: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = readPackage(result.preparation.bytes);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const document = readPartText(stored.value, "word/document.xml") ?? "";
    expect(document).toContain("{{matter.number}}");
    expect(document).not.toContain("MERGEFIELD");
    expect(result.preparation.warnings.map((warning) => warning.code)).toContain(
      "merge-field-converted",
    );
    // Feedback either way: what was found, and that it was converted.
    expect(result.preparation.mergeFieldsConverted).toBe(true);
    expect(result.preparation.mergeFieldDetections).toHaveLength(1);
  });

  it("reports a stripped macro project on the successful registration, not only in the logs", async () => {
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      passThroughScrub,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The administrator who registered the template is told their document had code in it and that it
    // was taken out — the same feedback principle the merge-field opt-in follows.
    expect(result.preparation.removedMacroParts).toEqual(["word/vbaProject.bin"]);
  });
});
