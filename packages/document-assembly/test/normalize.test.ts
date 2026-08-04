import { describe, expect, it } from "vitest";
import { normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, type PartMap } from "../src/ooxml/package.ts";
import {
  buildDocx,
  complexMergeFieldParagraph,
  documentXml,
  footerXml,
  footnotesXml,
  headerXml,
  paragraphOfRuns,
  simpleMergeFieldParagraph,
  type DocxParts,
} from "./support/docx-fixture.ts";

// The awkward shapes here are drawn from the failure modes DOCX templating engines actually hit in
// pathological documents: a placeholder whose braces sit in different runs than its key, one split at a
// spellcheck or language boundary, one that shares a run with ordinary prose, two placeholders adjacent
// with nothing between them, and the same field repeated in a header, a footer, and a footnote. Each is
// a case where a naive per-run search finds nothing and silently emits a document with visible braces.

function partsOf(overrides: DocxParts): PartMap {
  const read = readPackage(buildDocx(overrides));
  if (!read.ok) throw new Error(`fixture unreadable: ${read.reason}`);
  return read.value;
}

function documentTextOf(parts: PartMap, partName = "word/document.xml"): string {
  const xml = readPartText(parts, partName) ?? "";
  // The visible text of the part, with markup and the XML declaration's trailing newline removed —
  // what a reader would see.
  return xml.replace(/<[^>]*>/g, "").trim();
}

// Every placeholder must end up inside exactly one w:t element. Counting the w:t elements that carry a
// complete placeholder against the number of opening braces is what proves reassembly happened rather
// than the text merely reading correctly when concatenated.
function contiguousPlaceholderCount(parts: PartMap, partName = "word/document.xml"): number {
  const xml = readPartText(parts, partName) ?? "";
  let count = 0;
  for (const match of xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)) {
    count += [...(match[1] ?? "").matchAll(/\{\{[^{}]*\}\}/g)].length;
  }
  return count;
}

describe("normalization — run splitting", () => {
  it("reassembles a placeholder whose braces sit in different runs than its key", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          paragraphOfRuns("Matter ", "{", "{matter.", "number", "}", "} filed today."),
        ),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("Matter {{matter.number}} filed today.");
    expect(contiguousPlaceholderCount(result.parts)).toBe(1);
    expect(result.manifest.fields).toEqual([
      {
        key: "matter.number",
        format: null,
        occurrences: 1,
        parts: ["word/document.xml"],
        forms: ["brace"],
      },
    ]);
  });

  it("reassembles a placeholder split one character per run", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns(...[..."{{firm.name}}"])) }),
    );
    expect(result.failures).toEqual([]);
    expect(contiguousPlaceholderCount(result.parts)).toBe(1);
    expect(documentTextOf(result.parts)).toBe("{{firm.name}}");
  });

  it("handles two adjacent placeholders with nothing between them", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(paragraphOfRuns("{{matter.number", "}}{{", "client.displayName}}")),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{matter.number}}{{client.displayName}}");
    expect(contiguousPlaceholderCount(result.parts)).toBe(2);
  });

  it("keeps the prose around a placeholder that shares its run", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          paragraphOfRuns(
            "Dear {{client.displa",
            "yName}}, regarding matter {{matter.",
            "number}}.",
          ),
        ),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe(
      "Dear {{client.displayName}}, regarding matter {{matter.number}}.",
    );
  });

  it("tolerates whitespace inside the braces and stores the canonical form", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("{{  matter.number  }}")) }),
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{matter.number}}");
  });

  it("normalizes inside a table cell", () => {
    const cell =
      "<w:tbl><w:tr><w:tc>" + paragraphOfRuns("{{location.", "name}}") + "</w:tc></w:tr></w:tbl>";
    const result = normalizeTemplate(partsOf({ document: documentXml(cell) }));
    expect(result.failures).toEqual([]);
    expect(contiguousPlaceholderCount(result.parts)).toBe(1);
  });

  it("normalizes inside a hyperlink, which nests runs one level deeper in the paragraph", () => {
    const paragraph = `<w:p><w:hyperlink r:id="rId9">${paragraphInnerRuns("{{firm.", "name}}")}</w:hyperlink></w:p>`;
    const result = normalizeTemplate(partsOf({ document: documentXml(paragraph) }));
    expect(result.failures).toEqual([]);
    expect(contiguousPlaceholderCount(result.parts)).toBe(1);
  });

  it("normalizes headers, footers, and footnotes, not only the main document", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(paragraphOfRuns("Body.")),
        header: headerXml(paragraphOfRuns("{{location.", "addressBlock}}")),
        footer: footerXml(paragraphOfRuns("{{location.rem", "itTo}}")),
        footnotes: footnotesXml(paragraphOfRuns("{{firm.na", "me}}")),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(contiguousPlaceholderCount(result.parts, "word/header1.xml")).toBe(1);
    expect(contiguousPlaceholderCount(result.parts, "word/footer1.xml")).toBe(1);
    expect(contiguousPlaceholderCount(result.parts, "word/footnotes.xml")).toBe(1);
    expect(result.manifest.fields.map((field) => field.key).sort()).toEqual([
      "firm.name",
      "location.addressBlock",
      "location.remitTo",
    ]);
  });

  it("records every part a repeated field occurs in, and counts its occurrences", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          paragraphOfRuns("{{matter.number}}"),
          paragraphOfRuns("again: {{matter.number}}"),
        ),
        header: headerXml(paragraphOfRuns("{{matter.number}}")),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.fields).toHaveLength(1);
    expect(result.manifest.fields[0]).toMatchObject({
      key: "matter.number",
      occurrences: 3,
      parts: ["word/document.xml", "word/header1.xml"],
    });
    expect(result.manifest.totalOccurrences).toBe(3);
  });

  it("treats a key with a format override as its own manifest entry", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(paragraphOfRuns("{{matter.openedOn}} and {{matter.openedOn:legal}}")),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.fields.map((field) => field.format)).toEqual([null, "legal"]);
  });

  it("leaves a template with no placeholders untouched, with a warning that says so", () => {
    const document = documentXml(paragraphOfRuns("Nothing to merge here."));
    const result = normalizeTemplate(partsOf({ document }));
    expect(result.failures).toEqual([]);
    expect(result.manifest.fields).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("no-placeholders");
  });
});

// Conversion is OPT-IN. Detection is not: the pass always reports what it found, because rewriting a
// firm's own uploaded template without being asked is the failure mode the opt-in exists to prevent.
const converting = { convertMergeFields: true } as const;

describe("normalization — Word merge fields are detected without being converted", () => {
  it("detects a merge field and leaves the document exactly as authored", () => {
    const original = documentXml(complexMergeFieldParagraph("matter.number"));
    const result = normalizeTemplate(partsOf({ document: original }));
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
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    expect(xml).toContain("MERGEFIELD");
    expect(xml).toContain("fldChar");
    expect(xml).not.toContain("{{matter.number}}");
  });

  it("REFUSES registration rather than storing a template whose merge fields nothing will fill in", () => {
    // Left as authored, a merge field is invisible to the assembly engine and renders Word's frozen
    // cached result — a filed document that looks complete and is wrong. The refusal carries the
    // guidance, so the caller can offer the choice rather than a dead end.
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("matter.number")) }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      code: "merge-field-conversion-required",
      part: "word/document.xml",
    });
    expect(result.failures[0]?.detail).toContain("matter.number");
    expect(result.failures[0]?.detail).toContain("converted");
  });

  it("detects a simple field too, and names the form it took", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(simpleMergeFieldParagraph("client.displayName")) }),
    );
    expect(result.mergeFieldDetections[0]).toMatchObject({
      fieldName: "client.displayName",
      form: "simple",
      mapsToKnownField: true,
    });
  });

  it("reports a field name that maps to no merge field, so opting in would not silently bind it", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("ClientName")) }),
    );
    expect(result.mergeFieldDetections[0]).toMatchObject({
      fieldName: "ClientName",
      mappedKey: "ClientName",
      mapsToKnownField: false,
    });
  });

  it("applies an injected name mapping, which is the seam the per-firm mapping library replaces", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("ClientName")) }),
      {
        convertMergeFields: true,
        resolveMergeFieldName: (name) => (name === "ClientName" ? "client.displayName" : name),
      },
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{client.displayName}}");
    expect(result.mergeFieldDetections[0]).toMatchObject({
      fieldName: "ClientName",
      mappedKey: "client.displayName",
      mapsToKnownField: true,
    });
  });

  it("detects nothing, and refuses nothing, in a template with no merge fields", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("{{matter.number}}")) }),
    );
    expect(result.mergeFieldDetections).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});

describe("normalization — Word MERGEFIELD conversion, when the caller opts in", () => {
  it("converts a complex field construct whose instruction is itself split across runs", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("matter.number")) }),
      converting,
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{matter.number}}");
    expect(result.manifest.fields[0]).toMatchObject({
      key: "matter.number",
      forms: ["mergeField"],
    });
    // The field machinery is gone: nothing downstream has to understand two placeholder forms.
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    expect(xml).not.toContain("fldChar");
    expect(xml).not.toContain("instrText");
    expect(xml).not.toContain("MERGEFIELD");
  });

  it("carries the cached result run's formatting onto the converted placeholder", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("firm.name")) }),
      converting,
    );
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    // The bold the field's result carried is the formatting the merged value must inherit.
    expect(xml).toContain("<w:b");
  });

  it("converts a simple field", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(simpleMergeFieldParagraph("client.displayName")) }),
      converting,
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{client.displayName}}");
    expect(readPartText(result.parts, "word/document.xml") ?? "").not.toContain("fldSimple");
  });

  it("converts a quoted field name", () => {
    const paragraph =
      `<w:p><w:fldSimple w:instr=" MERGEFIELD  &quot;matter.number&quot;  \\* MERGEFORMAT ">` +
      `<w:r><w:t>«matter.number»</w:t></w:r></w:fldSimple></w:p>`;
    const result = normalizeTemplate(partsOf({ document: documentXml(paragraph) }), converting);
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{matter.number}}");
  });

  it("leaves a non-merge field exactly as authored", () => {
    const paragraph =
      "<w:p>" +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> PAGE  \\* MERGEFORMAT </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      "<w:r><w:t>1</w:t></w:r>" +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      "</w:p>";
    const result = normalizeTemplate(partsOf({ document: documentXml(paragraph) }));
    expect(result.failures).toEqual([]);
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    expect(xml).toContain("PAGE");
    expect(xml).toContain("fldChar");
  });

  it("reports a converted merge field as a warning so the author sees the template changed shape", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("firm.name")) }),
      converting,
    );
    expect(result.warnings.map((warning) => warning.code)).toContain("merge-field-converted");
  });

  it("mixes both authoring forms in one template and records which each field came from", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          paragraphOfRuns("{{matter.", "number}}"),
          complexMergeFieldParagraph("firm.name"),
        ),
      }),
      converting,
    );
    expect(result.failures).toEqual([]);
    const byKey = new Map(result.manifest.fields.map((field) => [field.key, field.forms]));
    expect(byKey.get("matter.number")).toEqual(["brace"]);
    expect(byKey.get("firm.name")).toEqual(["mergeField"]);
  });
});

describe("normalization — registration failures carry locations", () => {
  it("refuses an unclosed delimiter", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("Matter {{matter.number and then prose")) }),
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      code: "unclosed-delimiter",
      part: "word/document.xml",
    });
    expect(result.failures[0]?.excerpt).toContain("Matter {{matter.number");
  });

  it("refuses a stray closing delimiter", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("orphaned }} here")) }),
    );
    expect(result.failures[0]).toMatchObject({ code: "stray-delimiter" });
  });

  it("refuses a key the dictionary does not have, naming it", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("{{matter.numbre}}")) }),
    );
    expect(result.failures[0]).toMatchObject({
      code: "unknown-key",
      part: "word/document.xml",
    });
    expect(result.failures[0]?.detail).toContain("matter.numbre");
  });

  it("refuses a format the key's type does not support", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("{{matter.number:legal}}")) }),
    );
    expect(result.failures[0]).toMatchObject({ code: "unknown-format" });
  });

  it("refuses an empty key", () => {
    const result = normalizeTemplate(partsOf({ document: documentXml(paragraphOfRuns("{{}}")) }));
    expect(result.failures[0]).toMatchObject({ code: "empty-key" });
  });

  it("refuses block markers, which are not built yet, rather than reading them as a field name", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(paragraphOfRuns("{{#if client.code}}"), paragraphOfRuns("{{/if}}")),
      }),
    );
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "block-syntax-unsupported",
      "block-syntax-unsupported",
    ]);
  });

  it("reports a failure in a header with the header's part name", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(paragraphOfRuns("Body.")),
        header: headerXml(paragraphOfRuns("{{nope.key}}")),
      }),
    );
    expect(result.failures[0]).toMatchObject({
      code: "unknown-key",
      part: "word/header1.xml",
    });
  });

  it("records the normalizer version that produced the result", () => {
    const result = normalizeTemplate(partsOf({}));
    expect(result.normalizerVersion).toBeGreaterThanOrEqual(1);
  });
});

function paragraphInnerRuns(...fragments: readonly string[]): string {
  return fragments
    .map((fragment) => `<w:r><w:t xml:space="preserve">${fragment}</w:t></w:r>`)
    .join("");
}
