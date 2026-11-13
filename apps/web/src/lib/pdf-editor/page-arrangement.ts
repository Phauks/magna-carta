/*
 * The pages of a PDF as the reader has rearranged them, before anything is saved.
 *
 * An arrangement is a list of the document's own pages, each with the turn the reader gave it. The
 * list order is the new page order, and a page left out of the list is deleted. Nothing here
 * touches the document: saving hands the engine a plan built from the arrangement (`buildPlan`),
 * and the engine makes the new document in a worker.
 *
 * The engine has no single "rearrange" call, so a plan is made from the three it does have. Turns
 * are applied to the original first, grouped by angle, because the engine turns a page relative to
 * how it already sits. Then the turned document is cut into runs of consecutive pages in the new
 * order, and the runs are joined. A run keeps its pages' bookmarks and form fields, which a
 * page-by-page copy would lose, so runs are kept as long as the order allows.
 */

/** A quarter-turn count expressed in degrees, clockwise, as the engine takes it. */
export type PageTurn = 0 | 90 | 180 | 270;

/** One page in the arrangement. */
export interface ArrangedPage {
  /** Zero-based index of the page in the original document. Also the page's identity here. */
  readonly source: number;
  /** How far the reader has turned it, clockwise, on top of how it already sits. */
  readonly turn: PageTurn;
}

/** An inclusive, zero-based run of the original's pages, as the engine's split takes it. */
export interface PageRun {
  readonly start: number;
  readonly end: number;
}

/** What the engine is asked to do to make one new document from the original. */
export interface ArrangementPlan {
  /** Pages to turn, by angle, before anything else. Empty when nothing was turned. */
  readonly turns: readonly { readonly angle: 90 | 180 | 270; readonly pages: readonly number[] }[];
  /** The runs to cut out of the turned document and join, in order. */
  readonly runs: readonly PageRun[];
}

/** The document as it stands: every page, in order, unturned. */
export function initialArrangement(pageCount: number): ArrangedPage[] {
  return Array.from({ length: pageCount }, (_, source) => ({ source, turn: 0 as const }));
}

function addTurn(turn: PageTurn, by: 90 | -90): PageTurn {
  return ((((turn + by) % 360) + 360) % 360) as PageTurn;
}

/** Turn the chosen pages a quarter turn either way. */
export function turnPages(
  pages: readonly ArrangedPage[],
  chosen: ReadonlySet<number>,
  by: 90 | -90,
): ArrangedPage[] {
  return pages.map((page) =>
    chosen.has(page.source) ? { ...page, turn: addTurn(page.turn, by) } : page,
  );
}

/** Leave the chosen pages out. */
export function removePages(
  pages: readonly ArrangedPage[],
  chosen: ReadonlySet<number>,
): ArrangedPage[] {
  return pages.filter((page) => !chosen.has(page.source));
}

/**
 * Move the chosen pages, keeping their order among themselves, so they sit together before the
 * page now at `beforeIndex` (or at the end when `beforeIndex` is the length). This is what a drag
 * of a selection does, and also what the keyboard's move earlier and move later do.
 */
export function movePages(
  pages: readonly ArrangedPage[],
  chosen: ReadonlySet<number>,
  beforeIndex: number,
): ArrangedPage[] {
  const moving = pages.filter((page) => chosen.has(page.source));
  if (moving.length === 0) return [...pages];
  const anchor = pages.slice(beforeIndex).find((page) => !chosen.has(page.source)) ?? null;
  const staying = pages.filter((page) => !chosen.has(page.source));
  const at = anchor === null ? staying.length : staying.indexOf(anchor);
  return [...staying.slice(0, at), ...moving, ...staying.slice(at)];
}

/** Move the chosen pages one place earlier (-1) or later (1), as a block. */
export function nudgePages(
  pages: readonly ArrangedPage[],
  chosen: ReadonlySet<number>,
  by: -1 | 1,
): ArrangedPage[] {
  const positions = pages.flatMap((page, index) => (chosen.has(page.source) ? [index] : []));
  if (positions.length === 0) return [...pages];
  const first = positions[0] as number;
  const last = positions.at(-1) as number;
  if (by === -1) return first === 0 ? [...pages] : movePages(pages, chosen, first - 1);
  return last === pages.length - 1 ? [...pages] : movePages(pages, chosen, last + 2);
}

/** Whether the arrangement is the document as it already is. */
export function isUnchanged(pages: readonly ArrangedPage[], pageCount: number): boolean {
  return (
    pages.length === pageCount &&
    pages.every((page, index) => page.source === index && page.turn === 0)
  );
}

/** Whether the reader has moved a page from where it was, as opposed to only turning one. */
export function wasMoved(page: ArrangedPage, index: number): boolean {
  return page.source !== index;
}

/** The plan that makes one document holding exactly these pages, in this order, so turned. */
export function buildPlan(pages: readonly ArrangedPage[]): ArrangementPlan {
  const byAngle = new Map<90 | 180 | 270, number[]>();
  for (const page of pages) {
    if (page.turn === 0) continue;
    const list = byAngle.get(page.turn) ?? [];
    list.push(page.source);
    byAngle.set(page.turn, list);
  }
  const turns = ([90, 180, 270] as const).flatMap((angle) => {
    const list = byAngle.get(angle);
    return list === undefined ? [] : [{ angle, pages: list.toSorted((a, b) => a - b) }];
  });
  const runs: PageRun[] = [];
  for (const page of pages) {
    const last = runs.at(-1);
    if (last !== undefined && last.end + 1 === page.source) {
      runs[runs.length - 1] = { start: last.start, end: page.source };
    } else {
      runs.push({ start: page.source, end: page.source });
    }
  }
  return { turns, runs };
}

/**
 * Cut the arrangement into parts, starting a new part at each chosen page. The first page always
 * starts the first part, so choosing it adds nothing. Parts keep the arrangement's order and turns.
 */
export function splitAt(
  pages: readonly ArrangedPage[],
  starts: ReadonlySet<number>,
): ArrangedPage[][] {
  const parts: ArrangedPage[][] = [];
  for (const page of pages) {
    const current = parts.at(-1);
    if (current === undefined || starts.has(page.source)) parts.push([page]);
    else current.push(page);
  }
  return parts;
}

/**
 * Page numbers as a reader writes them, counting from one: "3-5, 9". Used in the name of a file
 * made from some of the pages, so the name says which.
 */
export function pageListLabel(sources: readonly number[]): string {
  const sorted = [...new Set(sources)].toSorted((a, b) => a - b);
  const pieces: string[] = [];
  let runStart: number | null = null;
  let previous: number | null = null;
  const close = (): void => {
    if (runStart === null || previous === null) return;
    pieces.push(runStart === previous ? `${runStart + 1}` : `${runStart + 1}-${previous + 1}`);
  };
  for (const page of sorted) {
    if (previous !== null && page === previous + 1) {
      previous = page;
      continue;
    }
    close();
    runStart = page;
    previous = page;
  }
  close();
  return pieces.join(", ");
}

function stemAndExtension(originalName: string): { stem: string; extension: string } {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < originalName.length - 1;
  return {
    stem: hasExtension ? originalName.slice(0, dot) : originalName,
    extension: hasExtension ? originalName.slice(dot) : ".pdf",
  };
}

/** "Smith.pdf" with pages 3 to 5 taken out -> "Smith (Pages 3-5).pdf". */
export function extractedCopyName(originalName: string, sources: readonly number[]): string {
  const { stem, extension } = stemAndExtension(originalName);
  const label = pageListLabel(sources);
  return sources.length === 1
    ? `${stem} (Page ${label})${extension}`
    : `${stem} (Pages ${label})${extension}`;
}

/** "Smith.pdf" split in three -> "Smith (Part 1 of 3).pdf" and so on. */
export function partName(originalName: string, part: number, of: number): string {
  const { stem, extension } = stemAndExtension(originalName);
  return `${stem} (Part ${part} of ${of})${extension}`;
}
