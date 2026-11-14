// The house document: how a document Magna Carta generates looks, and the pieces one is built
// from. A package that prints a record (a certificate, a report, an exhibit list) describes its
// sections with the builders here and names no colour, margin, typeface or paper size of its own.
//
// Everything here is plain data in the shape the PDF composer (packages/pdf-compose) accepts, so
// this package carries no WebAssembly and a layout is tested as a value. The caller that holds the
// composer turns the result into pages with `composeReadable`.

import { brandLockupPng } from "./brand-lockup.ts";

/** A label and its value, one row of a list of fields. */
export interface HouseField {
  readonly label: string;
  readonly value: string;
  /** The value's words set in columns of one width, so its lines stand under one another. */
  readonly grid?: true;
}

/** A table's column: its heading and its share of the table's width. */
export interface HouseColumn {
  readonly heading: string;
  readonly weight: number;
  /** Where the column's cells sit: `end` for figures, which then line up on the right. */
  readonly alignment?: "start" | "center" | "end";
}

/**
 * What sets a table's row apart: `total` sums the rows above it (bold, under a darker rule),
 * `child` is a part of the row above it (gray, stepped in), `muted` is kept for the record but no
 * longer in force (gray), as a withdrawn exhibit is.
 */
export type HouseRowKind = "total" | "child" | "muted";

/** A table's row: its cells, or its cells and what sets it apart. */
export type HouseRow =
  | readonly string[]
  | { readonly cells: readonly string[]; readonly kind: HouseRowKind };

/** One figure of a summary: what it counts, the figure, and a line about it. */
export interface HouseFigure {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  /** Printed in red: a figure a reader should not pass over, such as an overdue balance. */
  readonly alert?: true;
}

/** The blocks a house document is made of, a subset of the composer's own. */
export type HouseBlock =
  | { readonly type: "pageBreak" }
  | { readonly type: "cardStart"; readonly title?: string }
  | { readonly type: "cardEnd" }
  | { readonly type: "heading"; readonly level: 1 | 2; readonly text: string }
  | {
      readonly type: "paragraph";
      readonly text: string;
      readonly alignment?: "center";
    }
  | {
      readonly type: "paragraph";
      readonly spans: readonly { readonly text: string; readonly bold?: boolean }[];
      readonly small: true;
    }
  | {
      readonly type: "fields";
      readonly fields: readonly HouseField[];
      /** Two columns side by side, read down the first and then the second. */
      readonly twoUp?: true;
    }
  | {
      readonly type: "table";
      readonly columns: readonly HouseColumn[];
      readonly rows: readonly (readonly string[])[];
      /** How each row is set, by position. Written by `styledTable`. */
      readonly rowStyles?: readonly (HouseRowKind | null)[];
    }
  /** Summary figures across the page. Written by `figures`. */
  | { readonly type: "figures"; readonly figures: readonly HouseFigure[] }
  /** A cover sheet's label. Written by `coverSheet`. */
  | { readonly type: "display"; readonly text: string; readonly spaceAbove: number }
  /** Lines to sign on. Written by `signatureLines`. */
  | { readonly type: "signatureLines"; readonly lines: readonly string[] }
  /** A picture named by its position in the list passed to the composer beside the document. */
  | {
      readonly type: "image";
      readonly image: number;
      readonly width: number;
      /** What the picture is, set small above it. */
      readonly label: string;
      /** Set on the line of the picture before it. */
      readonly beside?: true;
    };

/**
 * The families the composer carries. Atkinson Hyperlegible, the application's own reading face,
 * draws Latin only; Liberation Sans also draws Greek and Cyrillic.
 */
export type HouseTypeface = "atkinsonHyperlegible" | "liberationSans";

/** The paper a document is laid out for: US Letter unless told otherwise. */
export type HousePaper = "letter" | "a4";

/** What heads every page: a picture, the document's name and a labelled reference. */
export interface HouseLetterhead {
  readonly image: number;
  readonly title: string;
  readonly label?: string;
  readonly detail?: string;
}

/** A document the PDF composer accepts as it stands. */
export interface HouseDocument {
  readonly title: string;
  readonly subject?: string;
  readonly language: string;
  readonly created?: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
  };
  readonly page: {
    readonly paper: HousePaper;
    /** The paper turned on its side, for a table too wide for it upright. */
    readonly landscape?: true;
    readonly marginTop: number;
    readonly marginRight: number;
    readonly marginBottom: number;
    readonly marginLeft: number;
  };
  /** The colour of the headings, the cards' title bars and the rules: red, green and blue. */
  readonly accent: readonly [number, number, number];
  /** Rows set closer together. */
  readonly compact: true;
  readonly letterhead?: HouseLetterhead;
  /** The family the document is set in. */
  readonly typeface: HouseTypeface;
  readonly footer: { readonly center: string };
  readonly blocks: readonly HouseBlock[];
}

/**
 * The dark gold the application uses for an accent on a light ground (`accent-700` in
 * packages/design-tokens), as the red, green and blue a printed page needs.
 */
export const HOUSE_ACCENT = [98, 72, 0] as const;

/** Each paper's width and height in points, as the composer has them. */
const PAPER_SIZE: Record<HousePaper, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

/**
 * How far every edge of the printed sheet stays from the edge of the paper, in points: half an
 * inch on all four sides. The letterhead's bar starts there, the page number sits there, and the
 * cards run from one side margin to the other. Half an inch is inside what a desktop printer
 * reaches on Letter and on A4.
 */
export const PAGE_EDGE = 36;

/** The room the composer's letterhead takes above the content, and its footer below it. */
const LETTERHEAD_HEIGHT = 60;
const FOOTER_HEIGHT = 28;

/** What the composer's card takes above what it holds: the bar its title sits in. */
const CARD_TITLE_HEIGHT = 27;

/** The composer's compact row: a line of cell text, and the space above and below a row. */
const ROW_LINE_HEIGHT = 13;
const ROW_PADDING = 3;

/** The margins of a page: the edge, and with a letterhead the room it takes at the top. */
function pageMargins(letterhead: boolean): { top: number; bottom: number } {
  return {
    top: PAGE_EDGE + (letterhead ? LETTERHEAD_HEIGHT : 0),
    bottom: PAGE_EDGE + FOOTER_HEIGHT,
  };
}

/** The width and height a page of `paper` gives the content, in points. */
export function contentSize(
  paper: HousePaper,
  letterhead = true,
  landscape = false,
): { width: number; height: number } {
  const margins = pageMargins(letterhead);
  const size = PAPER_SIZE[paper];
  const [width, height] = landscape ? [size.height, size.width] : [size.width, size.height];
  return { width: width - 2 * PAGE_EDGE, height: height - margins.top - margins.bottom };
}

/** What a document says about itself; the house supplies the rest. */
export interface HouseDocumentOptions {
  /** The document's name: in the file's metadata and, with a letterhead, at the head of every page. */
  readonly name: string;
  readonly subject?: string;
  /** A BCP 47 tag. American English unless told otherwise. */
  readonly language?: string;
  /** When the document was made, as an instant. One that does not read as an instant is left out. */
  readonly created?: string;
  readonly paper?: HousePaper;
  /** Turn the paper on its side, for a table of many columns. */
  readonly landscape?: true;
  /**
   * The family to set the document in: Atkinson Hyperlegible unless told otherwise.
   * `composeReadable` asks for Liberation Sans when the text is in a script Atkinson cannot draw.
   */
  readonly typeface?: HouseTypeface;
  /**
   * The document's own number, printed under its name at the head of every page: what it is
   * called ("Reference", "Matter") and its value.
   */
  readonly reference?: { readonly label: string; readonly value: string };
  /**
   * `false` prints no letterhead: the content starts half an inch from the top of the paper. For
   * a document that goes out under someone else's heading, such as a court filing.
   */
  readonly letterhead?: false;
  readonly blocks: readonly HouseBlock[];
}

/**
 * A document in the house style: its margins, accent, typeface, letterhead and page number. The
 * letterhead's picture is the first of `housePictures`.
 */
export function houseDocument(
  options: HouseDocumentOptions & { readonly letterhead?: undefined },
): HouseDocument & { readonly letterhead: HouseLetterhead };
export function houseDocument(options: HouseDocumentOptions): HouseDocument;
export function houseDocument(options: HouseDocumentOptions): HouseDocument {
  const letterhead = options.letterhead !== false;
  const margins = pageMargins(letterhead);
  const created = options.created === undefined ? undefined : createdOn(options.created);
  return {
    title: options.name,
    ...(options.subject !== undefined ? { subject: options.subject } : {}),
    language: options.language ?? "en-US",
    ...(created !== undefined ? { created } : {}),
    page: {
      paper: options.paper ?? "letter",
      ...(options.landscape === true ? { landscape: true as const } : {}),
      marginTop: margins.top,
      marginRight: PAGE_EDGE,
      marginBottom: margins.bottom,
      marginLeft: PAGE_EDGE,
    },
    accent: HOUSE_ACCENT,
    compact: true,
    typeface: options.typeface ?? "atkinsonHyperlegible",
    ...(letterhead
      ? {
          letterhead: {
            image: 0,
            title: options.name,
            ...(options.reference !== undefined
              ? { label: options.reference.label, detail: options.reference.value }
              : {}),
          },
        }
      : {}),
    footer: { center: "Page {page} of {pages}" },
    blocks: options.blocks,
  };
}

/**
 * The pictures a house document names by position: the lockup its letterhead draws, then the
 * document's own in the order given. Passed to the composer beside the document.
 */
export function housePictures(pictures: readonly Uint8Array[] = []): Uint8Array[] {
  return [brandLockupPng(), ...pictures];
}

/** A section: its name in a bar across the top of a frame around `blocks`. */
export function card(title: string | undefined, ...blocks: readonly HouseBlock[]): HouseBlock[] {
  return [
    title === undefined ? { type: "cardStart" } : { type: "cardStart", title },
    ...blocks,
    { type: "cardEnd" },
  ];
}

/**
 * A table whose rows may be totals, parts of the row above, or withdrawn. Plain rows are given as
 * their cells alone, and a table of only plain rows is the plain table.
 */
export function styledTable(
  columns: readonly HouseColumn[],
  rows: readonly HouseRow[],
): HouseBlock {
  const cells = rows.map((row) => ("cells" in row ? row.cells : row));
  const kinds = rows.map((row) => ("cells" in row ? row.kind : null));
  return {
    type: "table",
    columns,
    rows: cells,
    ...(kinds.some((kind) => kind !== null) ? { rowStyles: kinds } : {}),
  };
}

/**
 * The figures a report opens with, across the page: four to six read best. More than six run
 * onto a second line.
 */
export function figures(list: readonly HouseFigure[]): HouseBlock {
  return { type: "figures", figures: list };
}

/** Lines to sign on, two to a row, each with what it is for beneath it: `Signature`, `Date`. */
export function signatureLines(...captions: readonly string[]): HouseBlock {
  return { type: "signatureLines", lines: captions };
}

/** The composer's cover label and body text: the height of a line of each. */
const DISPLAY_LINE_HEIGHT = 48;
const BODY_LINE_HEIGHT = 15;

/** Where a cover sheet is printed. */
export interface CoverSheetOptions {
  readonly paper?: HousePaper;
  /** `false` when the document has no letterhead, which leaves a page more room. */
  readonly letterhead?: false;
}

/**
 * A sheet that stands in front of something: a label set very large (`EXHIBIT 4`) with centred
 * lines under it, a little above the middle of the page, where the eye puts the middle. It takes
 * a sheet to itself: put a `pageBreak` after it, and before it unless it opens the document.
 */
export function coverSheet(
  label: string,
  lines: readonly string[] = [],
  options: CoverSheetOptions = {},
): HouseBlock[] {
  const content = contentSize(options.paper ?? "letter", options.letterhead !== false);
  const height = DISPLAY_LINE_HEIGHT + lines.length * BODY_LINE_HEIGHT;
  const spaceAbove = Math.max(0, Math.round((content.height - height) * 0.42));
  return [
    { type: "display", text: label, spaceAbove },
    ...lines.map((text) => ({ type: "paragraph", text, alignment: "center" }) as const),
  ];
}

/** `Signer Details (1 of 3)`: a section's heading on each of its pages, plain where it has one. */
export function pageHeading(section: string, page: number, pages: number): string {
  return pages > 1 ? `${section} (${page + 1} of ${pages})` : section;
}

/** A small line that says what it is about in bold, then the parts that are present. */
export function noteLine(about: string, parts: readonly (string | undefined)[]): HouseBlock {
  const present = parts.filter((part): part is string => part !== undefined && part !== "");
  return {
    type: "paragraph",
    small: true,
    spans: [{ text: `${about}: `, bold: true }, { text: present.join(", ") }],
  };
}

/**
 * A long code (a hash, a serial number) as lines of 32 characters, each set in groups of four, so
 * a reader comparing it against another copy keeps their place. Set it in a field with `grid`.
 */
export function groupedCode(code: string): string {
  const lines = code.match(/.{1,32}/g) ?? [code];
  return lines.map((line) => (line.match(/.{1,4}/g) ?? [line]).join(" ")).join("\n");
}

/**
 * `2026-07-18 12:00:01`: an instant to the second, in Coordinated Universal Time. A printed
 * document is read by people in more than one zone, and a converted time invites the question of
 * whose clock it was. What does not read as an instant is returned as it stands.
 */
export function clock(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * An instant as two rows, `Label: Date` and `Label: Time`. One that does not read as an instant is
 * a single row holding what was recorded.
 */
export function instantFields(label: string, instant: string): HouseField[] {
  const read = clock(instant);
  if (read === instant) return [{ label, value: instant }];
  return [
    { label: `${label}: Date`, value: read.slice(0, 10) },
    { label: `${label}: Time`, value: `${read.slice(11)} UTC` },
  ];
}

function createdOn(instant: string): HouseDocument["created"] {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/** Page numbers as a reader says them: runs joined with a dash, as "Pages 1-3, 7". */
export function pageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].toSorted((a, b) => a - b);
  const runs: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (sorted[end + 1] === (sorted[end] ?? 0) + 1) end += 1;
    runs.push(end > start ? `${sorted[start]}-${sorted[end]}` : `${sorted[start]}`);
    start = end + 1;
  }
  return `${sorted.length === 1 ? "Page" : "Pages"} ${runs.join(", ")}`;
}

/**
 * The width to print a picture at so it stands `height` points tall, and no wider than `widest`.
 * A PNG says its size in its first chunk; any other picture is printed at half of `widest`. A
 * long signature drawn small and a short one drawn large then print at the same height.
 */
export function pictureWidth(image: Uint8Array, height: number, widest: number): number {
  const isPng = image.length >= 24 && image[0] === 0x89 && image[1] === 0x50;
  if (!isPng) return widest / 2;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const [pixelWidth, pixelHeight] = [view.getUint32(16), view.getUint32(20)];
  if (pixelWidth === 0 || pixelHeight === 0) return widest / 2;
  return Math.min(widest, Math.round((height * pixelWidth) / pixelHeight));
}

/**
 * How many characters of cell text fit a column one percent of the table wide, for each point of
 * the table's width. The composer measures real glyphs; this package cannot, so it assumes text a
 * little wider than it usually is.
 */
const CHARACTERS_PER_WEIGHT_POINT = 0.92 / 468;

/** How a long table is split into pages. */
export interface TablePagesOptions {
  readonly paper?: HousePaper;
  readonly landscape?: true;
  /**
   * Columns whose cells are sized to fit and never wrap (a time, a number), by position. They
   * are left out of the estimate of a row's height.
   */
  readonly fittedColumns?: readonly number[];
  /** `false` when the document has no letterhead, which leaves a page more room. */
  readonly letterhead?: false;
}

/** The lines a row is expected to take in a table `width` points wide: its most-wrapped cell. */
function estimatedLines(
  columns: readonly HouseColumn[],
  row: readonly string[],
  width: number,
  fitted: readonly number[],
): number {
  let lines = 1;
  for (const [index, cell] of row.entries()) {
    const column = columns[index];
    if (column === undefined || fitted.includes(index)) continue;
    const capacity = Math.max(1, Math.floor(column.weight * CHARACTERS_PER_WEIGHT_POINT * width));
    lines = Math.max(lines, Math.ceil(cell.length / capacity));
  }
  return lines;
}

/**
 * A table's rows a page at a time, for a table that has a page to itself inside a card. A page is
 * filled by the height its rows are expected to take, so short rows run well down the page and
 * long ones still break where the next page's heading can be printed above what follows. The
 * columns' weights share the width out of a hundred. Always at least one page, which may be empty.
 */
export function tablePages(
  columns: readonly HouseColumn[],
  rows: readonly (readonly string[])[],
  options: TablePagesOptions = {},
): (readonly string[])[][] {
  const content = contentSize(
    options.paper ?? "letter",
    options.letterhead !== false,
    options.landscape === true,
  );
  // The page, less the card's title, less the table's own heading row, less a margin for the
  // estimate being an estimate.
  const room = content.height - CARD_TITLE_HEIGHT - (ROW_LINE_HEIGHT + ROW_PADDING) - 20;
  const fitted = options.fittedColumns ?? [];
  const pages: (readonly string[])[][] = [[]];
  let used = 0;
  for (const row of rows) {
    const height =
      estimatedLines(columns, row, content.width, fitted) * ROW_LINE_HEIGHT + ROW_PADDING;
    const page = pages.at(-1);
    if (page === undefined || (used + height > room && page.length > 0)) {
      pages.push([row]);
      used = height;
    } else {
      page.push(row);
      used += height;
    }
  }
  return pages;
}

/**
 * A long table as a section of its own: each page starts on a new sheet as a card titled with the
 * section's name and its place, `Audit Log (2 of 3)`.
 */
export function pagedTable(
  section: string,
  columns: readonly HouseColumn[],
  rows: readonly (readonly string[])[],
  options: TablePagesOptions = {},
): HouseBlock[] {
  const pages = tablePages(columns, rows, options);
  return pages.flatMap((pageRows, page) => [
    { type: "pageBreak" } as const,
    ...card(pageHeading(section, page, pages.length), { type: "table", columns, rows: pageRows }),
  ]);
}

/** What `composeReadable` needs of a composed document: the characters its typeface lacked. */
interface Composed {
  readonly missingCharacters: readonly string[];
}

/**
 * Compose a document so every character on it is drawn. `compose` is the caller's own call into
 * the composer for a given typeface. The house typeface draws Latin only, so when the composer
 * reports a character it could not draw the document is set again in Liberation Sans, which draws
 * Greek and Cyrillic as well.
 */
export async function composeReadable<Result extends Composed>(
  compose: (typeface: HouseTypeface | undefined) => Promise<Result>,
): Promise<Result> {
  const first = await compose(undefined);
  return first.missingCharacters.length > 0 ? compose("liberationSans") : first;
}
