/*
 * The tabular composer — this package's second production writer, and the platform's first table
 * emitter. Where `assemble` fills a firm's own template, this composes a plain document from a
 * renderable tabular export: a title, the client-rendered generation stamp, then each section as a
 * bold heading over a bordered table whose header row repeats across page breaks. Plain is the
 * product on the owner's direction; the themed treatment is a reserved seam that will fill a
 * firm-registered report template — never a platform-composed second answer to the firm's
 * letterhead. Spec: docs/specs/2026-08-31-tabular-export-rendering-design.md.
 *
 * Output goes through the same `writePackage` every emitted package crosses (pinned entry
 * timestamps, so the same document yields the same bytes), every `w:t` declares
 * `xml:space="preserve"`, and layout opinions beyond the page frame stay the office suite's.
 */
import type {
  RenderableTabularDocument,
  RenderableTabularSection,
} from "@magna-carta/export-document/renderable";
import { writePackage, type PartMap } from "../ooxml/package.ts";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORDPROCESSINGML = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// US Letter in twentieths of a point: 8.5 by 11 inches, one-inch margins. The usable text width
// (page minus margins) is what the column plan divides.
const PAGE_WIDTH_DXA = 12_240;
const PAGE_HEIGHT_DXA = 15_840;
const MARGIN_DXA = 1_440;
const USABLE_WIDTH_DXA = PAGE_WIDTH_DXA - 2 * MARGIN_DXA;

// Column widths derive from content length in characters. ~110 dxa approximates one character of
// the 11pt body face; the clamps keep a one-character column tappable and a prose column from
// swallowing the page before proportional scaling evens the plan out.
const DXA_PER_CHARACTER = 110;
const COLUMN_PADDING_DXA = 240;
const MINIMUM_COLUMN_DXA = 700;
const MAXIMUM_COLUMN_DXA = 4_800;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** A text run; `xml:space="preserve"` because Word strips undeclared edge whitespace. */
function run(text: string, options: { bold?: boolean; halfPointSize?: number } = {}): string {
  const properties = [
    options.bold === true ? "<w:b/>" : "",
    options.halfPointSize === undefined ? "" : `<w:sz w:val="${options.halfPointSize}"/>`,
  ].join("");
  const runProperties = properties === "" ? "" : `<w:rPr>${properties}</w:rPr>`;
  return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

interface ParagraphOptions {
  readonly bold?: boolean;
  readonly halfPointSize?: number;
  readonly alignEnd?: boolean;
  readonly spacingBeforeDxa?: number;
  readonly spacingAfterDxa?: number;
}

function paragraph(text: string, options: ParagraphOptions = {}): string {
  const properties = [
    options.spacingBeforeDxa !== undefined || options.spacingAfterDxa !== undefined
      ? `<w:spacing w:before="${options.spacingBeforeDxa ?? 0}" w:after="${options.spacingAfterDxa ?? 0}"/>`
      : "",
    options.alignEnd === true ? '<w:jc w:val="right"/>' : "",
  ].join("");
  const paragraphProperties = properties === "" ? "" : `<w:pPr>${properties}</w:pPr>`;
  const body =
    text === "" ? "" : run(text, { bold: options.bold, halfPointSize: options.halfPointSize });
  return `<w:p>${paragraphProperties}${body}</w:p>`;
}

/** Widths per column, sized from content and scaled proportionally into the usable page width. */
export function columnPlanDxa(section: RenderableTabularSection): number[] {
  const columnCount = section.headers.length;
  const widths = section.headers.map((header, columnIndex) => {
    const longest = Math.max(
      header.length,
      ...section.rows.map((row) => (row[columnIndex] ?? "").length),
    );
    return Math.min(
      Math.max(longest * DXA_PER_CHARACTER + COLUMN_PADDING_DXA, MINIMUM_COLUMN_DXA),
      MAXIMUM_COLUMN_DXA,
    );
  });
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= USABLE_WIDTH_DXA) return widths;
  const scale = USABLE_WIDTH_DXA / total;
  const scaled = widths.map((width) => Math.max(Math.floor(width * scale), MINIMUM_COLUMN_DXA));
  // Rounding drift lands on the last column so the grid always sums to what the rows declare.
  const scaledTotal = scaled.reduce((sum, width) => sum + width, 0);
  const lastIndex = columnCount - 1;
  const last = scaled[lastIndex];
  if (last !== undefined)
    scaled[lastIndex] = Math.max(
      last + (Math.min(scaledTotal, USABLE_WIDTH_DXA) - scaledTotal),
      MINIMUM_COLUMN_DXA,
    );
  return scaled;
}

function tableCell(
  text: string,
  widthDxa: number,
  options: { bold?: boolean; alignEnd?: boolean },
): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/></w:tcPr>` +
    paragraph(text, { bold: options.bold, alignEnd: options.alignEnd }) +
    "</w:tc>"
  );
}

function table(section: RenderableTabularSection): string {
  const widths = columnPlanDxa(section);
  const endAligned = new Set(section.endAlignedColumns ?? []);
  const width = (columnIndex: number): number => widths[columnIndex] ?? MINIMUM_COLUMN_DXA;

  const grid = widths.map((columnWidth) => `<w:gridCol w:w="${columnWidth}"/>`).join("");
  // tblHeader repeats the header row at the top of every page the table crosses.
  const headerRow =
    "<w:tr><w:trPr><w:tblHeader/></w:trPr>" +
    section.headers
      .map((header, columnIndex) =>
        tableCell(header, width(columnIndex), {
          bold: true,
          alignEnd: endAligned.has(columnIndex),
        }),
      )
      .join("") +
    "</w:tr>";
  const dataRows = section.rows
    .map(
      (row) =>
        "<w:tr>" +
        section.headers
          .map((unused, columnIndex) =>
            tableCell(row[columnIndex] ?? "", width(columnIndex), {
              alignEnd: endAligned.has(columnIndex),
            }),
          )
          .join("") +
        "</w:tr>",
    )
    .join("");

  const borders =
    "<w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
      .join("") +
    "</w:tblBorders>";
  return (
    "<w:tbl><w:tblPr>" +
    '<w:tblLayout w:type="fixed"/>' +
    borders +
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>' +
    "</w:tblPr>" +
    `<w:tblGrid>${grid}</w:tblGrid>` +
    headerRow +
    dataRows +
    "</w:tbl>"
  );
}

function documentPart(renderable: RenderableTabularDocument): string {
  const blocks: string[] = [
    paragraph(renderable.title, { bold: true, halfPointSize: 32, spacingAfterDxa: 60 }),
    ...renderable.stampLines.map((line) => paragraph(line, { halfPointSize: 20 })),
  ];
  for (const section of renderable.sections) {
    blocks.push(
      paragraph(section.title, {
        bold: true,
        halfPointSize: 24,
        spacingBeforeDxa: 360,
        spacingAfterDxa: 120,
      }),
      table(section),
    );
  }
  const sectionProperties =
    "<w:sectPr>" +
    `<w:pgSz w:w="${PAGE_WIDTH_DXA}" w:h="${PAGE_HEIGHT_DXA}"/>` +
    `<w:pgMar w:top="${MARGIN_DXA}" w:right="${MARGIN_DXA}" w:bottom="${MARGIN_DXA}" w:left="${MARGIN_DXA}" w:header="720" w:footer="720" w:gutter="0"/>` +
    "</w:sectPr>";
  return (
    `${XML_DECLARATION}<w:document xmlns:w="${WORDPROCESSINGML}"><w:body>` +
    blocks.join("") +
    sectionProperties +
    "</w:body></w:document>"
  );
}

// The default character face and size every run inherits; single-spaced paragraphs. Everything a
// run does not override comes from here, which is what keeps the emitted parts small.
const STYLES_PART =
  `${XML_DECLARATION}<w:styles xmlns:w="${WORDPROCESSINGML}">` +
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
  "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>" +
  '<w:spacing w:after="40" w:line="240" w:lineRule="auto"/>' +
  "</w:pPr></w:pPrDefault></w:docDefaults>" +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  "</w:styles>";

const CONTENT_TYPES_PART_XML =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  "</Types>";

const ROOT_RELATIONSHIPS_PART =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const DOCUMENT_RELATIONSHIPS_PART =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

const encoder = new TextEncoder();

/** Compose the renderable document into a WordprocessingML package. Pure: same input, same bytes. */
export function composeTabularDocument(renderable: RenderableTabularDocument): Uint8Array {
  const parts: PartMap = new Map([
    ["[Content_Types].xml", encoder.encode(CONTENT_TYPES_PART_XML)],
    ["_rels/.rels", encoder.encode(ROOT_RELATIONSHIPS_PART)],
    ["word/document.xml", encoder.encode(documentPart(renderable))],
    ["word/_rels/document.xml.rels", encoder.encode(DOCUMENT_RELATIONSHIPS_PART)],
    ["word/styles.xml", encoder.encode(STYLES_PART)],
  ]);
  return writePackage(parts);
}
