/*
 * The redactions a reader has marked on a PDF, before any of them is applied.
 *
 * TWO COORDINATE SPACES MEET HERE. The reader draws in screen pixels, from the top-left corner of
 * the page as it is shown at the current zoom. The engine takes PDF points (a 72nd of an inch)
 * from the page's BOTTOM-left corner, which is how a PDF stores every position. A box is kept in
 * the engine's space from the moment it is drawn, so changing the zoom never moves a mark, and is
 * converted back to screen space only to be drawn. Both conversions are pure and tested.
 *
 * Nothing in this module removes anything. Applying is the engine's job, in a worker
 * (`pdf-operations.ts`), and the engine verifies its own output before it hands a document back.
 */
import type { PdfPageSize } from "$lib/documents/pdf-pages.ts";

/** A rectangle in PDF points, bottom-left origin: the space the engine reads. */
export interface PagePointRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A rectangle on screen, in CSS pixels from the page's top-left corner. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Why a passage is withheld. Written on the redaction log, never drawn on the page. */
export const REDACTION_REASONS = [
  "Personal Identifier",
  "Phone Number",
  "Account Number",
  "Date of Birth",
  "Medical",
  "Privileged",
  "Work Product",
  "Confidential",
  "Other",
] as const;

export type RedactionReason = (typeof REDACTION_REASONS)[number];

/** One marked region, not yet applied. */
export interface MarkedRedaction {
  /** Local to this screen. A mark is not an entity and never becomes one. */
  readonly key: string;
  /** Zero-based page index, as the engine counts. */
  readonly page: number;
  readonly rect: PagePointRect;
  readonly reason: RedactionReason;
  /** Whether the mark covers the whole page, which the list says rather than giving a size. */
  readonly wholePage: boolean;
}

/**
 * The smallest box that counts as a deliberate mark, in screen pixels on each side. A click that
 * moved a pixel or two is a click, not a redaction, and an engine handed a zero-area box refuses it.
 */
export const MINIMUM_MARK_PIXELS = 4;

/** Points per CSS pixel at a zoom, matching how `pageDisplaySize` lays a page out. */
function pointsPerPixel(zoom: number): number {
  return 72 / (96 * zoom);
}

/**
 * Two corners the reader dragged between, as a box on screen. Either corner may be the first: a
 * drag up and to the left draws the same box as one down and to the right. The box is held inside
 * the page, because a mark that runs off the page covers nothing out there.
 */
export function boxBetween(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  pageWidth: number,
  pageHeight: number,
): ScreenRect {
  const clampX = (value: number): number => Math.min(pageWidth, Math.max(0, value));
  const clampY = (value: number): number => Math.min(pageHeight, Math.max(0, value));
  const left = Math.min(clampX(start.x), clampX(end.x));
  const right = Math.max(clampX(start.x), clampX(end.x));
  const top = Math.min(clampY(start.y), clampY(end.y));
  const bottom = Math.max(clampY(start.y), clampY(end.y));
  return { left, top, width: right - left, height: bottom - top };
}

/** Whether a drawn box is big enough to be a mark rather than a stray click. */
export function isDeliberateMark(box: ScreenRect): boolean {
  return box.width >= MINIMUM_MARK_PIXELS && box.height >= MINIMUM_MARK_PIXELS;
}

/** A box drawn on screen at a zoom, as the rectangle the engine reads. */
export function screenToPoints(box: ScreenRect, page: PdfPageSize, zoom: number): PagePointRect {
  const scale = pointsPerPixel(zoom);
  const x0 = box.left * scale;
  const x1 = (box.left + box.width) * scale;
  // Screen y grows downward from the top; PDF y grows upward from the bottom.
  const y1 = page.heightPt - box.top * scale;
  const y0 = page.heightPt - (box.top + box.height) * scale;
  return {
    x0: Math.max(0, x0),
    y0: Math.max(0, y0),
    x1: Math.min(page.widthPt, x1),
    y1: Math.min(page.heightPt, y1),
  };
}

/** A rectangle the engine reads, as a box to draw on screen at a zoom. */
export function pointsToScreen(rect: PagePointRect, page: PdfPageSize, zoom: number): ScreenRect {
  const scale = 1 / pointsPerPixel(zoom);
  return {
    left: rect.x0 * scale,
    top: (page.heightPt - rect.y1) * scale,
    width: (rect.x1 - rect.x0) * scale,
    height: (rect.y1 - rect.y0) * scale,
  };
}

/** The whole of a page, as a rectangle the engine reads. */
export function wholePageRect(page: PdfPageSize): PagePointRect {
  return { x0: 0, y0: 0, x1: page.widthPt, y1: page.heightPt };
}

/**
 * The marks in the order a reader reviews them: by page, then from the top of the page down, then
 * left to right. The list numbers marks in this order, so the number on a box and the number in
 * the list always agree.
 */
export function inReadingOrder(marks: readonly MarkedRedaction[]): MarkedRedaction[] {
  return marks.toSorted(
    (first, second) =>
      first.page - second.page || second.rect.y1 - first.rect.y1 || first.rect.x0 - second.rect.x0,
  );
}

/** The regions to hand the engine, one per mark, carrying the reason. */
export function engineRegions(
  marks: readonly MarkedRedaction[],
): { page: number; rect: PagePointRect; reason: string }[] {
  return inReadingOrder(marks).map((mark) => ({
    page: mark.page,
    rect: mark.rect,
    reason: mark.reason,
  }));
}

/** The name a redacted copy is filed under, beside the original: "Smith.pdf" -> "Smith (Redacted).pdf". */
export function redactedCopyName(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < originalName.length - 1;
  const stem = hasExtension ? originalName.slice(0, dot) : originalName;
  const extension = hasExtension ? originalName.slice(dot) : ".pdf";
  return `${stem} (Redacted)${extension}`;
}

/** One row of the redaction log: what was withheld, where, and why. Never what it said. */
export interface RedactionLogRow {
  readonly number: number;
  readonly page: number;
  readonly reason: RedactionReason;
}

/** The log rows for the marks applied, numbered as the list numbers them, pages counted from one. */
export function redactionLog(marks: readonly MarkedRedaction[]): RedactionLogRow[] {
  return inReadingOrder(marks).map((mark, index) => ({
    number: index + 1,
    page: mark.page + 1,
    reason: mark.reason,
  }));
}

/** One CSV field, quoted, with any quote inside it doubled. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The log as comma-separated text, ready to save beside the redacted copy. */
export function redactionLogCsv(
  documentName: string,
  rows: readonly RedactionLogRow[],
  appliedAt: string,
): string {
  const lines = [
    ["Document", "Applied", "Number", "Page", "Reason"].join(","),
    ...rows.map((row) =>
      [
        csvField(documentName),
        csvField(appliedAt),
        String(row.number),
        String(row.page),
        csvField(row.reason),
      ].join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
