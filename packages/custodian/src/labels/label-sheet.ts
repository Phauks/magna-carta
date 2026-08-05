import { code128Bars } from "./code128.ts";

// A printable label sheet, rendered as SVG. SVG rather than PDF because a label is vector artwork
// with six strings on it — a browser prints it at true size from a stylesheet-free document, and
// generating one costs no engine, no Container, and no dependency. PDF would buy pagination we do
// not need: a sheet is one sheet.
//
// The geometry is a standard A4 24-up label sheet (three columns of eight, 70 mm x 37 mm), stated in
// millimetres so what prints is the size the sheet is. A firm on a different stock changes the
// constants; nothing else in the renderer knows the numbers.

export interface CustodyLabel {
  // What a scanner reads. An identifier handle, not a custody number: a scan has to resolve to
  // exactly one object with no lookup rule in between, and a number is a string a firm can re-render
  // (a prefix change, a migrated register) while a handle is the row itself.
  readonly scanPayload: string;
  // The line a person reads across the room — the custody number for a packet, the node name for a
  // location.
  readonly headline: string;
  // Up to two supporting lines: the packet's name, or the location's breadcrumb. Truncated rather
  // than wrapped, because a label that reflows is a label whose barcode moves.
  readonly lines: readonly string[];
}

// One sheet's worth. A request for more is refused rather than silently paginated: "print these
// labels" has to produce the sheet the person is holding, and a second page that appears somewhere
// else is how a label ends up on the wrong box.
export const CUSTODY_LABELS_PER_SHEET = 24;

const SHEET_WIDTH_MILLIMETRES = 210;
const SHEET_HEIGHT_MILLIMETRES = 297;
const COLUMNS = 3;
const ROWS = 8;
const LABEL_WIDTH = 70;
const LABEL_HEIGHT = 37;
const MARGIN_LEFT = 0;
const MARGIN_TOP = 0.5;
const PADDING = 4;
const BARCODE_HEIGHT = 12;
const HEADLINE_SIZE = 4.2;
const LINE_SIZE = 2.8;
const PAYLOAD_SIZE = 2.2;
// Characters that fit on a label line at LINE_SIZE, measured against the widest sans-serif glyphs.
// Truncation is deliberate and visible (an ellipsis), never silent clipping.
const MAX_LINE_CHARACTERS = 40;

export interface RenderCustodyLabelSheetOptions {
  // Where on the sheet to start printing, so a partly-used sheet is not wasted. Zero-based.
  readonly startPosition?: number;
}

export function renderCustodyLabelSheet(
  labels: readonly CustodyLabel[],
  options: RenderCustodyLabelSheetOptions = {},
): string {
  const startPosition = options.startPosition ?? 0;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MILLIMETRES}mm" height="${SHEET_HEIGHT_MILLIMETRES}mm" viewBox="0 0 ${SHEET_WIDTH_MILLIMETRES} ${SHEET_HEIGHT_MILLIMETRES}">`,
    `<rect width="${SHEET_WIDTH_MILLIMETRES}" height="${SHEET_HEIGHT_MILLIMETRES}" fill="#ffffff"/>`,
  ];
  for (const [index, label] of labels.entries()) {
    const position = startPosition + index;
    if (position >= COLUMNS * ROWS) break;
    const column = position % COLUMNS;
    const row = Math.floor(position / COLUMNS);
    const x = MARGIN_LEFT + column * LABEL_WIDTH;
    const y = MARGIN_TOP + row * LABEL_HEIGHT;
    parts.push(renderLabel(label, x, y));
  }
  parts.push("</svg>");
  return parts.join("\n");
}

function renderLabel(label: CustodyLabel, x: number, y: number): string {
  const { bars, widthModules } = code128Bars(label.scanPayload);
  const barcodeWidth = LABEL_WIDTH - PADDING * 2;
  const moduleWidth = barcodeWidth / widthModules;
  const barElements = bars
    .map(
      (bar) =>
        `<rect x="${round(bar.offsetModules * moduleWidth)}" y="0" width="${round(bar.widthModules * moduleWidth)}" height="${BARCODE_HEIGHT}" fill="#000000"/>`,
    )
    .join("");
  const textLines = label.lines
    .slice(0, 2)
    .map(
      (line, index) =>
        `<text x="0" y="${round(BARCODE_HEIGHT + 3 + HEADLINE_SIZE + 1 + index * (LINE_SIZE + 1.2))}" font-family="sans-serif" font-size="${LINE_SIZE}" fill="#000000">${escapeXml(truncate(line))}</text>`,
    )
    .join("");
  return [
    `<g transform="translate(${round(x + PADDING)} ${round(y + PADDING)})">`,
    `<g>${barElements}</g>`,
    // The scan payload in human-readable form under the bars, which is what lets a person key it in
    // when a scanner will not read a scuffed label.
    `<text x="0" y="${round(BARCODE_HEIGHT + 2.6)}" font-family="monospace" font-size="${PAYLOAD_SIZE}" fill="#000000">${escapeXml(label.scanPayload)}</text>`,
    `<text x="0" y="${round(BARCODE_HEIGHT + 3 + HEADLINE_SIZE)}" font-family="sans-serif" font-size="${HEADLINE_SIZE}" font-weight="bold" fill="#000000">${escapeXml(truncate(label.headline))}</text>`,
    textLines,
    "</g>",
  ].join("");
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_LINE_CHARACTERS) return collapsed;
  return `${collapsed.slice(0, MAX_LINE_CHARACTERS - 1)}…`;
}

function round(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

// Every string on a label is firm-supplied text (a packet name, a location name), so it is escaped
// on the way into the document. There is no path here that emits markup a caller provided.
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
