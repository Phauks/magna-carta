import { describe, expect, it } from "vitest";
import { macroResidue } from "../src/macros.ts";
import { mergeFieldNameResolverFor } from "../src/normalize.ts";
import { readPackage, readPartText } from "../src/ooxml/package.ts";
import { prepareTemplateVersion, type TemplateScrub } from "../src/register.ts";
import {
  buildDocx,
  complexMergeFieldParagraph,
  documentXml,
  MAIN_DOCUMENT_CONTENT_TYPE,
  paragraphOfRuns,
  simpleMergeFieldParagraph,
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

  it("REFUSES a macro-bearing template without the strip opt-in, naming both remedies", async () => {
    // Removing the macro project rewrites the firm's own document, so it is never done unasked; and a
    // template carrying live macros is never stored, because it is run against privileged client data.
    // That leaves exactly two ways through, and the refusal has to name both.
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      passThroughScrub,
    );
    expect(result).toMatchObject({ ok: false, reason: "macro-consent-required" });
    if (result.ok) return;
    expect(result.macroProjectFound).toBe(true);
    expect(result.detail).toContain("asking for the macros to be removed");
    expect(result.detail).toContain("macro-free copy");
    // The findings ride the refusal, so a caller can say what was found rather than "no".
    expect(result.macroFindings).toContainEqual({ kind: "part", detail: "word/vbaProject.bin" });
  });

  it("refuses a macro-bearing template even when the caller opted in to converting merge fields", async () => {
    // The two opt-ins are separate consents. Asking for one is not asking for the other.
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      passThroughScrub,
      { convertMergeFields: true },
    );
    expect(result).toMatchObject({ ok: false, reason: "macro-consent-required" });
  });

  it("leaves a macro-free template alone whether or not the strip was asked for", async () => {
    // The consent gate is about macro CONTENT, not about the flag: a stray content-type Override or any
    // other package oddity must not be read as macro-bearing and refuse an ordinary template.
    for (const stripMacros of [false, true]) {
      const result = await prepareTemplateVersion(buildDocx({}), passThroughScrub, { stripMacros });
      expect(result.ok, `stripMacros=${stripMacros}`).toBe(true);
      if (!result.ok) return;
      expect(result.preparation.removedMacroParts).toEqual([]);
      expect(result.preparation.macrosStripped).toBe(stripMacros);
    }
  });

  it("strips the payload and stores clean bytes when the caller opts in", async () => {
    // A firm migrating from an older system has macro templates and will ask us to take them. The
    // resolution is to strip on request rather than refuse outright — but only after the stripped
    // package is re-verified as clean.
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      passThroughScrub,
      { stripMacros: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preparation.macrosStripped).toBe(true);
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
      { stripMacros: true },
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

  it("REGISTERS a merge-field template without conversion, recording each field and the text it will print", async () => {
    // Conversion is opt-in, so the document is stored exactly as authored. The field is not lost to
    // sight: the manifest records it with the frozen text it renders, which is what puts a blank that
    // does not look like a blank in front of the same absence model an ordinary missing value meets.
    const result = await prepareTemplateVersion(
      buildDocx({
        document: documentXml(
          complexMergeFieldParagraph("matter.number", "2019-CV-00041"),
          simpleMergeFieldParagraph("ClientName"),
        ),
      }),
      passThroughScrub,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preparation.mergeFieldsConverted).toBe(false);
    expect(result.preparation.manifest.unconvertedMergeFields).toEqual([
      {
        fieldName: "ClientName",
        mappedKey: "ClientName",
        part: "word/document.xml",
        occurrences: 1,
        form: "simple",
        // Nothing guesses that `ClientName` means `client.displayName`.
        mapsToKnownField: false,
        frozenText: "«ClientName»",
      },
      {
        fieldName: "matter.number",
        mappedKey: "matter.number",
        part: "word/document.xml",
        occurrences: 1,
        form: "complex",
        mapsToKnownField: true,
        // The stale value the document prints today — the whole reason an author needs to see this.
        frozenText: "2019-CV-00041",
      },
    ]);
    expect(result.preparation.warnings.map((warning) => warning.code)).toContain(
      "merge-field-unconverted",
    );
    // Nothing was rewritten: the stored package still carries the field constructs as authored.
    const stored = readPackage(result.preparation.bytes);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(readPartText(stored.value, "word/document.xml") ?? "").toContain("MERGEFIELD");
    // And no mapping was confirmed, because nothing was converted.
    expect(result.preparation.confirmedMergeFieldMappings).toEqual([]);
  });

  it("still refuses a genuine authoring mistake in a document that also uses merge fields", async () => {
    // Registering an unconverted merge field is a recorded property of the template. A placeholder
    // naming no merge field is still a mistake nothing downstream can repair, so it still refuses.
    const result = await prepareTemplateVersion(
      buildDocx({
        document: documentXml(
          complexMergeFieldParagraph("matter.number"),
          paragraphOfRuns("Matter {{matter.numbre}}"),
        ),
      }),
      passThroughScrub,
    );
    expect(result).toMatchObject({ ok: false, reason: "normalization-failed" });
    if (result.ok) return;
    expect(result.normalizationFailures.map((finding) => finding.code)).toEqual(["unknown-key"]);
    // The merge-field feedback rides the refusal too.
    expect(result.mergeFieldDetections).toHaveLength(1);
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
    // Converted, so nothing is left on the manifest as unconverted.
    expect(result.preparation.manifest.unconvertedMergeFields).toEqual([]);
  });

  it("confirms every name-to-key mapping a conversion landed on, for the firm's mapping library", async () => {
    const result = await prepareTemplateVersion(
      buildDocx({
        document: documentXml(
          complexMergeFieldParagraph("ClientName"),
          simpleMergeFieldParagraph("FileNo"),
        ),
      }),
      passThroughScrub,
      {
        convertMergeFields: true,
        resolveMergeFieldName: mergeFieldNameResolverFor(
          new Map([
            ["ClientName", "client.displayName"],
            ["FileNo", "matter.number"],
          ]),
        ),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Re-confirmed on every conversion, so the library records that these answers are still current
    // rather than only that they were given once.
    expect(result.preparation.confirmedMergeFieldMappings).toEqual([
      { fieldName: "ClientName", mergeKey: "client.displayName" },
      { fieldName: "FileNo", mergeKey: "matter.number" },
    ]);
  });

  it("converts through the firm's confirmed mapping when one is supplied", async () => {
    // The resolver seam carries the firm's own library. `ClientName` means nothing to the engine; it
    // means `client.displayName` because this firm said so once.
    const result = await prepareTemplateVersion(
      buildDocx({ document: documentXml(simpleMergeFieldParagraph("ClientName")) }),
      passThroughScrub,
      {
        convertMergeFields: true,
        resolveMergeFieldName: mergeFieldNameResolverFor(
          new Map([["ClientName", "client.displayName"]]),
        ),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preparation.mergeFieldDetections[0]).toMatchObject({
      fieldName: "ClientName",
      mappedKey: "client.displayName",
      mapsToKnownField: true,
      mappedFromLibrary: true,
    });
    expect(result.preparation.manifest.fields.map((field) => field.key)).toEqual([
      "client.displayName",
    ]);
    const stored = readPackage(result.preparation.bytes);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(readPartText(stored.value, "word/document.xml") ?? "").toContain(
      "{{client.displayName}}",
    );
  });

  it("reports a stripped macro project on the successful registration, not only in the logs", async () => {
    const result = await prepareTemplateVersion(
      buildDocx(macroBearingTemplate()),
      passThroughScrub,
      { stripMacros: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The administrator who registered the template is told their document had code in it and that it
    // was taken out — the same feedback principle the merge-field opt-in follows.
    expect(result.preparation.removedMacroParts).toEqual(["word/vbaProject.bin"]);
  });
});
