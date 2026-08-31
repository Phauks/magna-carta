import { describe, expect, it } from "vitest";
import type { RenderableTabularDocument } from "@magna-carta/export-document/renderable";
import { packageIntegrityViolations } from "../src/assemble.ts";
import { columnPlanDxa, composeTabularDocument } from "../src/compose/tabular.ts";
import { readPackage, readPartText } from "../src/ooxml/package.ts";

const renderable: RenderableTabularDocument = {
  title: "Firm Usage",
  stampLines: ["Generated 8/31/2026", "12:57:56 PM PDT"],
  sections: [
    {
      title: "Storage",
      headers: ["Storage Class", "Objects", "Size"],
      rows: [
        ["Standard", "41,208", "1.1 TB"],
        ["Infrequent Access", "3,915", "153.0 GB"],
      ],
      endAlignedColumns: [1, 2],
    },
    {
      title: "People & Organizations <esq.>",
      headers: ["Record", "Count"],
      rows: [['Say "hi" & wave', "5"]],
    },
  ],
};

function documentXml(bytes: Uint8Array): string {
  const outcome = readPackage(bytes);
  if (!outcome.ok) throw new Error(`not a readable package: ${outcome.reason}`);
  return readPartText(outcome.value, "word/document.xml") ?? "";
}

describe("composeTabularDocument", () => {
  const bytes = composeTabularDocument(renderable);

  it("emits a readable word-processing package with no integrity violations", () => {
    const outcome = readPackage(bytes);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(packageIntegrityViolations(outcome.value)).toEqual([]);
  });

  it("is byte-reproducible: the same document yields the same bytes", () => {
    expect(composeTabularDocument(renderable)).toEqual(bytes);
  });

  it("carries the title, the stamp lines, and every section as a repeating-header table", () => {
    const xml = documentXml(bytes);
    expect(xml).toContain('<w:t xml:space="preserve">Firm Usage</w:t>');
    expect(xml).toContain("Generated 8/31/2026");
    expect(xml).toContain("12:57:56 PM PDT");
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml.match(/<w:tblHeader\/>/g)).toHaveLength(2);
    expect(xml).toContain("Storage Class");
    expect(xml).toContain("41,208");
  });

  it("escapes markup-significant characters rather than emitting them", () => {
    const xml = documentXml(bytes);
    expect(xml).toContain("People &amp; Organizations &lt;esq.&gt;");
    expect(xml).toContain("Say &quot;hi&quot; &amp; wave");
    expect(xml).not.toContain("<esq.>");
  });

  it("right-aligns exactly the end-aligned columns", () => {
    const xml = documentXml(bytes);
    // Two end-aligned columns over one header row and two data rows: six right-set paragraphs.
    expect(xml.match(/<w:jc w:val="right"\/>/g)).toHaveLength(6);
  });

  it("declares preserved whitespace on every text element", () => {
    const xml = documentXml(bytes);
    expect(xml.match(/<w:t /g)?.length).toBe(xml.match(/<w:t xml:space="preserve">/g)?.length);
  });
});

describe("columnPlanDxa", () => {
  it("sizes columns from content and never past the usable page width", () => {
    const widths = columnPlanDxa({
      title: "Wide",
      headers: ["A".repeat(200), "B".repeat(200), "C".repeat(200)],
      rows: [],
    });
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(12_240 - 2 * 1_440);
    expect(widths.every((width) => width >= 700)).toBe(true);
  });
});
