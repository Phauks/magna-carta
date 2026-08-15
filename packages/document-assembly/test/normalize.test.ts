import { describe, expect, it } from "vitest";
import { mergeFieldNameResolverFor, normalizeTemplate } from "../src/normalize.ts";
import { readPackage, readPartText, type PartMap } from "../src/ooxml/package.ts";
import {
  buildDocx,
  complexMergeFieldParagraph,
  contentControl,
  contentControlParagraph,
  documentXml,
  footerXml,
  footnotesXml,
  headerXml,
  legacyFormFieldParagraph,
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
      partsOf({ document: documentXml(paragraphOfRuns(..."{{firm.name}}")) }),
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
        mappedFromLibrary: false,
        frozenText: "«matter.number»",
      },
    ]);
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    expect(xml).toContain("MERGEFIELD");
    expect(xml).toContain("fldChar");
    expect(xml).not.toContain("{{matter.number}}");
  });

  it("RECORDS each unconverted field on the manifest, with the frozen text it will print", () => {
    // Left as authored, a merge field is invisible to the assembly engine and renders Word's frozen
    // cached result — a filed document that looks complete and is wrong. Refusing the template would
    // keep that out of the product at the price of keeping the template out too; recording it on the
    // manifest is what makes the field visible to every reader downstream instead.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(complexMergeFieldParagraph("matter.number", "2019-CV-00041")),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.unconvertedMergeFields).toEqual([
      {
        fieldName: "matter.number",
        mappedKey: "matter.number",
        part: "word/document.xml",
        occurrences: 1,
        form: "complex",
        mapsToKnownField: true,
        frozenText: "2019-CV-00041",
      },
    ]);
    const warning = result.warnings.find((entry) => entry.code === "merge-field-unconverted");
    expect(warning?.detail).toContain("matter.number");
    expect(warning?.detail).toContain("cached");
  });

  it("does not call an unconverted-merge-field template placeholder-free", () => {
    // The no-placeholders warning means "every assembly of this produces the same document", which is
    // exactly what is NOT true of a template full of merge fields nothing will fill in.
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("matter.number")) }),
    );
    expect(result.warnings.map((warning) => warning.code)).not.toContain("no-placeholders");
  });

  it("detects a simple field too, and names the form it took", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(simpleMergeFieldParagraph("client.displayName")) }),
    );
    expect(result.mergeFieldDetections[0]).toMatchObject({
      fieldName: "client.displayName",
      form: "simple",
      mapsToKnownField: true,
      frozenText: "«client.displayName»",
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
      mappedFromLibrary: false,
    });
  });

  it("applies the firm's confirmed mapping, and says the mapping came from the library", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("ClientName")) }),
      {
        convertMergeFields: true,
        resolveMergeFieldName: mergeFieldNameResolverFor(
          new Map([["ClientName", "client.displayName"]]),
        ),
      },
    );
    expect(result.failures).toEqual([]);
    expect(documentTextOf(result.parts)).toBe("{{client.displayName}}");
    expect(result.mergeFieldDetections[0]).toMatchObject({
      fieldName: "ClientName",
      mappedKey: "client.displayName",
      mapsToKnownField: true,
      mappedFromLibrary: true,
    });
  });

  it("detects nothing, and records nothing, in a template with no merge fields", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("{{matter.number}}")) }),
    );
    expect(result.mergeFieldDetections).toEqual([]);
    expect(result.manifest.unconvertedMergeFields).toEqual([]);
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

  it("confirms a mapping only for a key the dictionary has", () => {
    // A conversion onto a real merge field is an answer worth remembering. One that produced a
    // placeholder naming a field nobody has is a mistake to fix — and it fails registration anyway —
    // so it never enters the firm's library as a confirmed meaning.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          complexMergeFieldParagraph("matter.number"),
          simpleMergeFieldParagraph("SomeFieldNobodyHas"),
        ),
      }),
      converting,
    );
    expect(result.failures.map((finding) => finding.code)).toEqual(["unknown-key"]);
    expect(result.confirmedMappings).toEqual([
      { fieldName: "matter.number", mergeKey: "matter.number" },
    ]);
  });

  it("confirms nothing when conversion was not asked for", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(complexMergeFieldParagraph("matter.number")) }),
    );
    expect(result.confirmedMappings).toEqual([]);
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
    // Word's own fields are not ours: nothing is recorded against the template for a PAGE field, which
    // renders correctly on its own and needs no merge value.
    expect(result.manifest.unconvertedMergeFields).toEqual([]);
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

// A legacy Word form field is the OTHER construct a firm's existing precedent binds through, and it is
// the one the engine cannot bind at all: no name it carries is a merge key, and the words it prints are
// the author's own instruction to whoever fills it in. The whole obligation here is that the template's
// registration SAYS SO — a template of this shape that registers clean, declares no keys, and reports
// no absence is a document filed carrying "Click here to enter caption" with nothing anywhere having
// mentioned it.
describe("normalization — legacy Word form fields are reported, never bound", () => {
  it("records a FORMTEXT field on the manifest, with the prompt and the text it prints", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          legacyFormFieldParagraph({
            name: "Caption",
            statusText: "enter name of party/parties appealing",
            result: "Click here to enter caption",
          }),
        ),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.legacyFormFields).toEqual([
      {
        fieldName: "Caption",
        kind: "text",
        part: "word/document.xml",
        occurrences: 1,
        helpText: "enter name of party/parties appealing",
        frozenText: "Click here to enter caption",
      },
    ]);
  });

  it("warns at registration, naming the construct and what a document will print", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          legacyFormFieldParagraph({ name: "Text1", result: "Click here to enter text." }),
        ),
      }),
    );
    // The absence is stated, not implied by a silence: a template of this shape must never reach the
    // "no merge fields at all" warning, which reads as a template that is simply static.
    expect(result.warnings.map((entry) => entry.code)).not.toContain("no-placeholders");
    const warning = result.warnings.find((entry) => entry.code === "legacy-form-field");
    expect(warning?.part).toBe("word/document.xml");
    expect(warning?.detail).toContain("Text1");
    expect(warning?.detail).toContain("Click here to enter text.");
  });

  it("leaves the document exactly as authored and derives no merge key from it", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(legacyFormFieldParagraph({ name: "Text1" })) }),
    );
    expect(result.manifest.fields).toEqual([]);
    // No name is invented for it, so nothing downstream can mistake one for a binding the firm made.
    expect(result.mergeFieldDetections).toEqual([]);
    expect(result.manifest.unconvertedMergeFields).toEqual([]);
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    expect(xml).toContain("FORMTEXT");
    expect(xml).toContain("w:ffData");
  });

  it("reports a checkbox and a dropdown as their own kinds", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          legacyFormFieldParagraph({ instruction: "FORMCHECKBOX", name: "Check1", result: "" }),
          legacyFormFieldParagraph({
            instruction: "FORMDROPDOWN",
            name: "Party",
            result: "Appellant",
          }),
        ),
      }),
    );
    expect(result.manifest.legacyFormFields.map((field) => field.kind)).toEqual([
      "checkbox",
      "dropDown",
    ]);
  });

  it("counts repeats of one field once, and reports a field in a header against the header", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          legacyFormFieldParagraph({ name: "Text1" }),
          legacyFormFieldParagraph({ name: "Text1" }),
        ),
        header: headerXml(legacyFormFieldParagraph({ name: "Text2" })),
      }),
    );
    expect(result.manifest.legacyFormFields).toEqual([
      {
        fieldName: "Text1",
        kind: "text",
        part: "word/document.xml",
        occurrences: 2,
        helpText: "",
        frozenText: "Click here to enter text.",
      },
      {
        fieldName: "Text2",
        kind: "text",
        part: "word/header1.xml",
        occurrences: 1,
        helpText: "",
        frozenText: "Click here to enter text.",
      },
    ]);
  });

  it("reports a form field carrying no name of its own rather than skipping it", () => {
    // Word writes `w:ffData` with no `w:name` for a field the author never named. It is still a hole
    // in the document, and a report that quietly drops the ones it cannot label is the same silence
    // this whole path exists to break.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          legacyFormFieldParagraph({ name: "", result: "Click here to enter caption" }),
        ),
      }),
    );
    expect(result.manifest.legacyFormFields).toHaveLength(1);
    expect(result.manifest.legacyFormFields[0]).toMatchObject({
      fieldName: "",
      frozenText: "Click here to enter caption",
    });
  });

  it("leaves a Word field that is neither a merge field nor a form field alone", () => {
    const paragraph =
      "<w:p>" +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      "<w:r><w:t>Table of contents</w:t></w:r>" +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      "</w:p>";
    const result = normalizeTemplate(partsOf({ document: documentXml(paragraph) }));
    expect(result.manifest.legacyFormFields).toEqual([]);
    expect(result.warnings.map((entry) => entry.code)).not.toContain("legacy-form-field");
  });
});

// A content control is the construct Word writes TODAY where an author inserts a blank, which makes it
// the one most likely to arrive in a template a firm authored this year. Unfilled, it prints "Click here
// to enter text." into every document assembled from the template — so the obligation is the same as the
// legacy form field's, and so is the trap: before this, such a template registered clean and warned only
// that it carried no merge fields, so every assembly of it produced the same document.
describe("normalization — unfilled content controls are reported, never bound", () => {
  it("records a control showing its placeholder, with both names its author gave it", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          contentControlParagraph({
            alias: "Client Name",
            tag: "clientName",
            content: "Click here to enter text.",
          }),
        ),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.unboundContentControls).toEqual([
      {
        alias: "Client Name",
        tag: "clientName",
        kind: "plainText",
        part: "word/document.xml",
        occurrences: 1,
        showingPlaceholder: true,
        dataBound: false,
        frozenText: "Click here to enter text.",
      },
    ]);
  });

  it("warns at registration rather than reporting a template of blanks as a static document", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(contentControlParagraph({ alias: "Caption" })),
      }),
    );
    // The false statement this whole path exists to end: a template that is nothing but blanks must
    // never be described as one every assembly of which produces the same document.
    expect(result.warnings.map((entry) => entry.code)).not.toContain("no-placeholders");
    const warning = result.warnings.find((entry) => entry.code === "unbound-content-control");
    expect(warning?.part).toBe("word/document.xml");
    expect(warning?.detail).toContain("Caption");
    expect(warning?.detail).toContain("Click here to enter text.");
  });

  it("leaves the control exactly as authored and derives no merge key from its alias or tag", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          contentControlParagraph({ alias: "Client Name", tag: "client.displayName" }),
        ),
      }),
    );
    // A tag that reads exactly like a merge key is still not one: nobody has confirmed that this
    // firm's document means by it what the dictionary means by it.
    expect(result.manifest.fields).toEqual([]);
    expect(result.manifest.unconvertedMergeFields).toEqual([]);
    expect(result.mergeFieldDetections).toEqual([]);
    const xml = readPartText(result.parts, "word/document.xml") ?? "";
    expect(xml).toContain("w:sdt");
    expect(xml).toContain("w:showingPlcHdr");
  });

  it("says nothing about a control an author filled in", () => {
    // Word wraps ordinary content in controls constantly — a cover page, a citation, anything built
    // from one of its own templates. A filled control prints text somebody typed, which is content and
    // not a hole, and warning on it would put a finding on documents with nothing wrong with them.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          contentControlParagraph({
            alias: "Firm Name",
            showingPlaceholder: false,
            content: "Riverside Law LLP",
          }),
        ),
      }),
    );
    expect(result.manifest.unboundContentControls).toEqual([]);
    expect(result.warnings.map((entry) => entry.code)).not.toContain("unbound-content-control");
    // And it stays what it always was: a template of static text, described as one.
    expect(result.warnings.map((entry) => entry.code)).toContain("no-placeholders");
  });

  it("reports what each control declares it holds, and says so when it declares nothing", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          contentControlParagraph({
            alias: "Filed",
            typeElement: '<w:date w:fullDate="2026-01-01T00:00:00Z"/>',
          }),
          contentControlParagraph({
            alias: "Party",
            typeElement:
              '<w:dropDownList><w:listItem w:displayText="Appellant" w:value="Appellant"/></w:dropDownList>',
          }),
          contentControlParagraph({ alias: "Body", typeElement: null }),
        ),
      }),
    );
    // Sorted by the label each is described by, so "Body", "Filed", "Party". A control that declares no
    // type is reported as declaring none rather than as the rich-text control it conventionally is —
    // what the document states, never what it probably means.
    expect(result.manifest.unboundContentControls.map((control) => control.kind)).toEqual([
      "unspecified",
      "date",
      "dropDownList",
    ]);
  });

  it("reports a control bound to data inside the template, with its own remedy", () => {
    // Nothing here writes the custom XML part such a control reads, so it prints whatever the document
    // this template was made from last put there — the unconverted-merge-field failure in a construct
    // that does not look like a field.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          contentControlParagraph({
            alias: "Matter Number",
            showingPlaceholder: false,
            dataBinding: '<w:dataBinding w:xpath="/matter[1]/number[1]" w:storeItemID="{FF1234}"/>',
            content: "2019-0117",
          }),
        ),
      }),
    );
    expect(result.manifest.unboundContentControls).toHaveLength(1);
    expect(result.manifest.unboundContentControls[0]).toMatchObject({
      alias: "Matter Number",
      showingPlaceholder: false,
      dataBound: true,
      frozenText: "2019-0117",
    });
    const warning = result.warnings.find((entry) => entry.code === "unbound-content-control");
    expect(warning?.detail).toContain("bound to data stored inside the template");
    expect(warning?.detail).toContain("2019-0117");
  });

  it("counts repeats of one control once, and reports one in a header against the header", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          contentControlParagraph({ alias: "Caption" }),
          contentControlParagraph({ alias: "Caption" }),
        ),
        header: headerXml(contentControlParagraph({ tag: "officeName" })),
      }),
    );
    expect(
      result.manifest.unboundContentControls.map((control) => [
        control.part,
        control.alias,
        control.tag,
        control.occurrences,
      ]),
    ).toEqual([
      ["word/document.xml", "Caption", "", 2],
      ["word/header1.xml", "", "officeName", 1],
    ]);
  });

  it("reports a control carrying neither an alias nor a tag by what it is", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(contentControlParagraph({})) }),
    );
    expect(result.manifest.unboundContentControls[0]).toMatchObject({ alias: "", tag: "" });
    const warning = result.warnings.find((entry) => entry.code === "unbound-content-control");
    expect(warning?.detail).toContain("an untitled Word plain text content control");
  });

  it("reports the blanks inside a repeating section rather than the wrapper around each copy", () => {
    // A repeating section's item wrapper is not a blank — it is the container a repeat puts around each
    // copy of its body — so reporting it would report one hole per iteration of holes already named.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          `<w:p>${contentControl({
            alias: "Exhibits",
            typeElement: "<w15:repeatingSection/>",
            contentXml: contentControl({
              typeElement: "<w15:repeatingSectionItem/>",
              contentXml: contentControl({ alias: "Exhibit", content: "Enter exhibit" }),
            }),
          })}</w:p>`,
        ),
      }),
    );
    expect(
      result.manifest.unboundContentControls.map((control) => [control.alias, control.kind]),
    ).toEqual([
      ["Exhibit", "plainText"],
      ["Exhibits", "repeatingSection"],
    ]);
  });

  it("keeps a placeholder written INSIDE a control working exactly as one outside it does", () => {
    // The control is transparent to both walks, which is what makes it a seam this engine can bind
    // later rather than a second placeholder syntax it would have to learn.
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          `<w:p>${contentControl({
            alias: "Matter Number",
            showingPlaceholder: false,
            contentXml: "<w:r><w:t>{{matter.</w:t></w:r><w:r><w:t>number}}</w:t></w:r>",
          })}</w:p>`,
        ),
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.manifest.fields.map((field) => field.key)).toEqual(["matter.number"]);
    expect(result.manifest.unboundContentControls).toEqual([]);
    expect(contiguousPlaceholderCount(result.parts)).toBe(1);
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

  it("reads a balanced conditional block and records it on the manifest", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          paragraphOfRuns("{{#if client.code}}"),
          paragraphOfRuns("Our reference is {{client.code}}."),
          paragraphOfRuns("{{/if}}"),
        ),
      }),
    );
    expect(result.failures).toEqual([]);
    // A BARE MERGE KEY as the whole condition means its PRESENCE when the key is not a boolean.
    expect(result.manifest.blocks).toEqual([
      {
        kind: "if",
        source: "client.code",
        resultType: "boolean",
        part: "word/document.xml",
        keys: ["client.code"],
        depth: 0,
      },
    ]);
  });

  it("refuses a block that opens and is never closed", () => {
    const result = normalizeTemplate(
      partsOf({ document: documentXml(paragraphOfRuns("{{#if client.code}}")) }),
    );
    expect(result.failures[0]).toMatchObject({ code: "block-unbalanced" });
  });

  it("refuses a block marker sharing its paragraph with prose", () => {
    const result = normalizeTemplate(
      partsOf({
        document: documentXml(
          paragraphOfRuns("Dear client, {{#if client.code}}"),
          paragraphOfRuns("{{/if}}"),
        ),
      }),
    );
    expect(result.failures[0]).toMatchObject({ code: "block-unbalanced" });
    expect(result.failures[0]?.detail).toContain("paragraph of its own");
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
