import { describe, expect, it } from "vitest";
import { absenceMarkerFor, assemble, packageIntegrityViolations } from "../src/assemble.ts";
import { normalizeTemplate } from "../src/normalize.ts";
import {
  contentTypeOverrides,
  readPackage,
  readPartText,
  writePackage,
  type PartMap,
} from "../src/ooxml/package.ts";
import type { MergeContext, MergeValue } from "../src/types.ts";
import {
  buildDocx,
  documentXml,
  footerXml,
  footnotesXml,
  headerXml,
  paragraphOfRuns,
  type DocxParts,
} from "./support/docx-fixture.ts";

function normalizedTemplateBytes(overrides: DocxParts): Uint8Array {
  const read = readPackage(buildDocx(overrides));
  if (!read.ok) throw new Error(`fixture unreadable: ${read.reason}`);
  const normalized = normalizeTemplate(read.value);
  if (normalized.failures.length > 0) {
    throw new Error(`fixture failed normalization: ${JSON.stringify(normalized.failures)}`);
  }
  return writePackage(normalized.parts);
}

function contextOf(entries: Record<string, MergeValue>, timeZone = "UTC"): MergeContext {
  return { values: new Map(Object.entries(entries)), absentKeys: [], timeZone };
}

function partsOfResultBytes(bytes: Uint8Array): PartMap {
  const read = readPackage(bytes);
  if (!read.ok) throw new Error(`output unreadable: ${read.reason}`);
  return read.value;
}

function visibleTextOf(parts: PartMap, partName = "word/document.xml"): string {
  return (readPartText(parts, partName) ?? "").replace(/<[^>]*>/g, "").trim();
}

const text = (value: string): MergeValue => ({ kind: "text", text: value });

describe("substitution", () => {
  it("substitutes a placeholder however Word had originally split it", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(
        paragraphOfRuns("Matter ", "{", "{matter.", "number", "}", "} is open."),
      ),
    });
    const result = assemble(bytes, contextOf({ "matter.number": text("2026-0042") }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(visibleTextOf(partsOfResultBytes(result.bytes))).toBe("Matter 2026-0042 is open.");
    expect(result.substitutions).toBe(1);
  });

  it("substitutes across every content-bearing part, not only the main document", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("{{matter.number}}")),
      header: headerXml(paragraphOfRuns("{{location.name}}")),
      footer: footerXml(paragraphOfRuns("{{location.remitTo}}")),
      footnotes: footnotesXml(paragraphOfRuns("{{firm.name}}")),
    });
    const result = assemble(
      bytes,
      contextOf({
        "matter.number": text("2026-0042"),
        "location.name": text("Riverside Office"),
        "location.remitTo": text("Remit to Riverside"),
        "firm.name": text("Riverside Law LLP"),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = partsOfResultBytes(result.bytes);
    expect(visibleTextOf(parts)).toBe("2026-0042");
    expect(visibleTextOf(parts, "word/header1.xml")).toBe("Riverside Office");
    expect(visibleTextOf(parts, "word/footer1.xml")).toBe("Remit to Riverside");
    expect(visibleTextOf(parts, "word/footnotes.xml")).toBe("Riverside Law LLP");
  });

  it("applies the dictionary's default format, and a per-placeholder override over it", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(
        paragraphOfRuns("default {{matter.openedOn}} legal {{matter.openedOn:legal}}"),
      ),
    });
    const result = assemble(
      bytes,
      contextOf({ "matter.openedOn": { kind: "instant", isoInstant: "2026-03-14T12:00:00.000Z" } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(visibleTextOf(partsOfResultBytes(result.bytes))).toBe(
      "default March 14, 2026 legal the 14th day of March, 2026",
    );
  });

  it("renders dates in the office's time zone the context carries", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("{{system.today:short}}")),
    });
    const context: MergeContext = {
      values: new Map([
        ["system.today", { kind: "instant", isoInstant: "2026-03-15T05:30:00.000Z" }],
      ]),
      absentKeys: [],
      timeZone: "America/Los_Angeles",
    };
    const result = assemble(bytes, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(visibleTextOf(partsOfResultBytes(result.bytes))).toBe("3/14/2026");
  });

  it("passes a template with no placeholders through unchanged", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("A fixed notice with nothing to merge.")),
    });
    const result = assemble(bytes, contextOf({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.substitutions).toBe(0);
    expect(readPartText(partsOfResultBytes(result.bytes), "word/document.xml")).toBe(
      readPartText(partsOfResultBytes(bytes), "word/document.xml"),
    );
  });

  it("is reproducible: the same template version and merge context yield the same bytes", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("{{matter.number}} for {{client.displayName}}")),
    });
    const context = contextOf({
      "matter.number": text("2026-0042"),
      "client.displayName": text("Acme Holdings LLC"),
    });
    const first = assemble(bytes, context);
    const second = assemble(bytes, context);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.bytes).toEqual(second.bytes);
  });

  it("preserves a value's leading and trailing spaces", () => {
    // Word strips whitespace from a text element that does not declare xml:space="preserve", so a value
    // that legitimately begins or ends with a space would silently lose it at the join with the
    // sentence around it.
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("a{{matter.title}}b")),
    });
    const result = assemble(bytes, contextOf({ "matter.title": text("  spaced  ") }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readPartText(partsOfResultBytes(result.bytes), "word/document.xml")).toContain(
      'xml:space="preserve"',
    );
    expect(visibleTextOf(partsOfResultBytes(result.bytes))).toBe("a  spaced  b");
  });
});

describe("absence handling", () => {
  it("renders a visible marker for a `placeholder` field and reports the key", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("Office: {{location.name}}")),
    });
    const result = assemble(bytes, contextOf({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(visibleTextOf(partsOfResultBytes(result.bytes))).toBe("Office: [LOCATION NAME]");
    expect(result.absences).toEqual([{ key: "location.name", rendered: "placeholder" }]);
  });

  it("renders nothing for a `blank` field and still reports the key", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("[{{matter.description}}]")),
    });
    const result = assemble(bytes, contextOf({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(visibleTextOf(partsOfResultBytes(result.bytes))).toBe("[]");
    expect(result.absences).toEqual([{ key: "matter.description", rendered: "blank" }]);
  });

  it("FAILS the assembly for a field declared `fail`, naming the key and nothing else", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("Matter No. {{matter.number}}")),
    });
    const result = assemble(bytes, contextOf({}));
    expect(result).toMatchObject({ ok: false, reason: "missing-required-field" });
    if (result.ok) return;
    expect(result.keys).toEqual(["matter.number"]);
    // The failure names WHICH key failed, never what any resolved field held.
    expect(result.detail).not.toContain("Acme");
  });

  it("never leaves an unsubstituted placeholder in the output", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("{{location.remitTo}} and {{matter.description}}")),
    });
    const result = assemble(bytes, contextOf({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readPartText(partsOfResultBytes(result.bytes), "word/document.xml")).not.toContain("{{");
  });

  it("derives a readable marker from a dotted camel-case key", () => {
    expect(absenceMarkerFor("client.displayName")).toBe("[CLIENT DISPLAY NAME]");
    expect(absenceMarkerFor("matter.number")).toBe("[MATTER NUMBER]");
  });
});

describe("package integrity of the emitted document", () => {
  it("emits a package whose part set, content types, and relationships all survive", () => {
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("{{matter.number}}")),
      header: headerXml(paragraphOfRuns("{{firm.name}}")),
    });
    const result = assemble(
      bytes,
      contextOf({ "matter.number": text("2026-0042"), "firm.name": text("Riverside Law LLP") }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = partsOfResultBytes(bytes);
    const after = partsOfResultBytes(result.bytes);
    // The assembler is purely subtractive and substitutive: it never adds a part, a relationship, a
    // script, or an external reference, and it never drops one either.
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    expect(contentTypeOverrides(after)).toEqual(contentTypeOverrides(before));
    expect(readPartText(after, "_rels/.rels")).toBe(readPartText(before, "_rels/.rels"));
    expect(packageIntegrityViolations(after)).toEqual([]);
  });

  it("emits parts that are still well-formed XML with exactly one declaration each", () => {
    // A part with two XML declarations is not well-formed — a document no reader will open, and one
    // nothing in a text-content assertion catches.
    const bytes = normalizedTemplateBytes({
      document: documentXml(paragraphOfRuns("{{matter.number}}")),
    });
    const result = assemble(bytes, contextOf({ "matter.number": text("2026-0042") }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const documentXmlText =
      readPartText(partsOfResultBytes(result.bytes), "word/document.xml") ?? "";
    expect([...documentXmlText.matchAll(/<\?xml/g)]).toHaveLength(1);
    expect(documentXmlText.startsWith("<?xml")).toBe(true);
    expect(documentXmlText).toContain("</w:document>");
  });

  it("catches a package that declares a content type for a part it does not carry", () => {
    const parts = partsOfResultBytes(buildDocx({}));
    parts.delete("docProps/core.xml");
    parts.set(
      "[Content_Types].xml",
      new TextEncoder().encode(
        '<?xml version="1.0"?><Types><Override PartName="/docProps/core.xml" ContentType="application/xml"/></Types>',
      ),
    );
    expect(packageIntegrityViolations(parts)).toContain(
      "content type declared for absent part docProps/core.xml",
    );
  });

  it("fails typed on an unreadable template rather than throwing", () => {
    expect(assemble(new TextEncoder().encode("not a package"), contextOf({}))).toMatchObject({
      ok: false,
      reason: "unreadable-template",
    });
  });
});
