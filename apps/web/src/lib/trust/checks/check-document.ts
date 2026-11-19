/*
 * A batch of trust checks, or a test page, as the PDF composer's document. Pure: the stock says
 * where each field goes, the checks say what it reads, and this places each line at its position on
 * a letter page. Composed in a Web Worker (check-pdf.worker.ts) from the payments the Checks screen
 * has read and the numbers it will send, before anything is recorded, so the server never holds the
 * PDF.
 *
 * Positions are thousandths of an inch on the stock and points in the document: 72 points to the
 * inch. The stock's whole-page shift moves every line on the page together, stubs included, because
 * a printer that feeds a little off feeds the whole sheet off.
 */
import type { ComposeBlock, ComposeDocument } from "@magna-carta/pdf-compose";
import {
  amountInFigures,
  amountInWords,
  checkPagePositions,
  CHECK_HEIGHT_MILS,
  CHECK_WIDTH_MILS,
  MICR_BAND_TOP_MILS,
  type CheckField,
  type CheckFieldKind,
  type CheckPageLayout,
} from "@magna-carta/trust/check-layout";

export interface CheckStockLayout {
  readonly pageLayout: CheckPageLayout;
  readonly fields: readonly CheckField[];
  readonly shiftXMils: number;
  readonly shiftYMils: number;
}

export interface PrintableCheck {
  readonly checkNumber: number;
  readonly payee: string;
  readonly amountMinor: number;
  readonly effectiveDate: string;
  readonly memo: string;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
}

/** What the test page prints in each box. */
export const SAMPLE_CHECK: PrintableCheck = {
  checkNumber: 10_422,
  payee: "Desert Title Company",
  amountMinor: 300_000,
  effectiveDate: "2026-10-31",
  memo: "Closing funds",
  matterNumber: "26-0141",
  matterTitle: "Harrington closing",
};

const points = (mils: number): number => (mils * 72) / 1_000;

/** The date as a United States check prints it: 10/31/2026. */
export function checkDateText(civilDate: string): string {
  const [year, month, day] = civilDate.split("-");
  return `${month}/${day}/${year}`;
}

export function matterText(check: PrintableCheck): string {
  return [check.matterNumber, check.matterTitle]
    .filter((part) => part !== null && part !== "")
    .join(" ");
}

/** What one field reads on one check. */
export function checkFieldText(kind: CheckFieldKind, check: PrintableCheck): string {
  switch (kind) {
    case "date":
      return checkDateText(check.effectiveDate);
    case "payee":
      return check.payee;
    case "amount":
      return amountInFigures(check.amountMinor);
    case "amount_words":
      return amountInWords(check.amountMinor);
    case "memo":
      return check.memo;
    case "matter":
      return matterText(check);
    case "check_number":
      return String(check.checkNumber);
  }
}

/**
 * One line of text at its place on the page, in thousandths of an inch from the page's top-left
 * corner. The PDF and the editor's page preview are both drawn from these, so the preview cannot
 * show a line anywhere the paper will not.
 */
export interface PlacedLine {
  readonly xMils: number;
  readonly yMils: number;
  readonly widthMils: number;
  readonly sizePoints: number;
  readonly align: "start" | "end";
  readonly bold: boolean;
  readonly text: string;
  /** A character repeated after the text to the end of the line. */
  readonly fill?: string;
}

/** The check's fields, for a check whose top edge is `topMils` down the page. */
export function checkLines(
  stock: CheckStockLayout,
  check: PrintableCheck,
  topMils: number,
): PlacedLine[] {
  return stock.fields.map((field) => ({
    xMils: field.xMils + stock.shiftXMils,
    yMils: topMils + field.yMils + stock.shiftYMils,
    widthMils: field.widthMils,
    sizePoints: field.sizePoints,
    align: field.align,
    bold: false,
    text: checkFieldText(field.kind, check),
    // Asterisks to the end of the line, so nothing can be written in after the amount.
    ...(field.kind === "amount_words" ? { fill: "*" } : {}),
  }));
}

/** The voucher stub: the same check's particulars, for the firm's file copy and the payee's. */
export function stubLines(
  stock: CheckStockLayout,
  check: PrintableCheck,
  topMils: number,
): PlacedLine[] {
  const left = 500 + stock.shiftXMils;
  const top = topMils + 400 + stock.shiftYMils;
  const rows: [string, string][] = [
    ["Check", `${check.checkNumber}    ${checkDateText(check.effectiveDate)}`],
    ["Pay to", check.payee],
    ["Amount", amountInFigures(check.amountMinor).replace("**", "$")],
    ["Matter", matterText(check)],
    ["Memo", check.memo],
  ];
  return rows.flatMap(([label, value], index): PlacedLine[] => [
    {
      xMils: left,
      yMils: top + index * 300,
      widthMils: 1_100,
      sizePoints: 9,
      align: "start",
      bold: false,
      text: label,
    },
    {
      xMils: left + 1_200,
      yMils: top + index * 300,
      widthMils: 6_300,
      sizePoints: 10,
      align: "start",
      bold: index === 0,
      text: value,
    },
  ]);
}

/**
 * One printed page: where its checks and stubs sit and every line on it. `checks` are the checks on
 * this page, in order; a page holds one with its stubs, or three on three-up stock.
 */
export function checkPage(
  stock: CheckStockLayout,
  checks: readonly PrintableCheck[],
): {
  readonly checkTops: readonly number[];
  readonly stubTops: readonly number[];
  readonly lines: readonly PlacedLine[];
} {
  const positions = checkPagePositions(stock.pageLayout);
  const checkTops = positions.checks.slice(0, Math.max(1, checks.length));
  const lines: PlacedLine[] = [];
  checks.slice(0, positions.checks.length).forEach((check, slot) => {
    lines.push(...checkLines(stock, check, positions.checks[slot] ?? 0));
  });
  const first = checks[0];
  if (positions.checks.length === 1 && first !== undefined) {
    for (const stubTop of positions.stubs) lines.push(...stubLines(stock, first, stubTop));
  }
  return { checkTops, stubTops: positions.stubs, lines };
}

/** The sample checks a whole page of this layout holds: one, or three numbered in a run. */
export function samplePageChecks(layout: CheckPageLayout): PrintableCheck[] {
  const count = checkPagePositions(layout).checks.length;
  return Array.from({ length: count }, (_, index) => ({
    ...SAMPLE_CHECK,
    checkNumber: SAMPLE_CHECK.checkNumber + index,
  }));
}

function placedBlock(line: PlacedLine, outline: boolean): ComposeBlock {
  return {
    type: "placed",
    x: points(line.xMils),
    y: points(line.yMils),
    width: points(line.widthMils),
    size: line.sizePoints,
    ...(line.align === "end" ? { alignment: "end" as const } : { alignment: "start" as const }),
    ...(line.bold ? { bold: true } : {}),
    text: line.text,
    ...(line.fill === undefined ? {} : { fill: line.fill }),
    ...(outline ? { outline: true } : {}),
  };
}

function checkBlocks(
  stock: CheckStockLayout,
  check: PrintableCheck,
  topMils: number,
  outline: boolean,
): ComposeBlock[] {
  return checkLines(stock, check, topMils).map((line) => placedBlock(line, outline));
}

function stubBlocks(
  stock: CheckStockLayout,
  check: PrintableCheck,
  topMils: number,
): ComposeBlock[] {
  return stubLines(stock, check, topMils).map((line) => placedBlock(line, false));
}

const LETTER_PAGE = {
  paper: "letter",
  marginTop: 36,
  marginRight: 36,
  marginBottom: 36,
  marginLeft: 36,
} as const;

/**
 * A batch of checks. One check per page with its stubs, or three to a page on three-up stock, in the
 * order the server numbered them.
 */
export function checkBatchDocument(
  stock: CheckStockLayout,
  checks: readonly PrintableCheck[],
): ComposeDocument {
  const positions = checkPagePositions(stock.pageLayout);
  const perPage = positions.checks.length;
  const blocks: ComposeBlock[] = [];
  checks.forEach((check, index) => {
    const slot = index % perPage;
    if (index > 0 && slot === 0) blocks.push({ type: "pageBreak" });
    blocks.push(...checkBlocks(stock, check, positions.checks[slot] ?? 0, false));
    if (perPage === 1) {
      for (const stubTop of positions.stubs) blocks.push(...stubBlocks(stock, check, stubTop));
    }
  });
  const first = checks[0]?.checkNumber;
  const last = checks.at(-1)?.checkNumber;
  return {
    title: first === last ? `Check ${first}` : `Checks ${first} to ${last}`,
    language: "en-US",
    page: LETTER_PAGE,
    blocks,
  };
}

/**
 * The test page: the stock's layout with sample values and a thin outline round every box, the
 * check's own edge and the MICR band, for printing on plain paper and holding over a real check
 * against the light.
 */
export function checkTestPageDocument(stock: CheckStockLayout): ComposeDocument {
  const positions = checkPagePositions(stock.pageLayout);
  const blocks: ComposeBlock[] = [];
  for (const top of positions.checks) {
    blocks.push({
      type: "placed",
      x: points(stock.shiftXMils),
      y: points(top + stock.shiftYMils),
      width: points(CHECK_WIDTH_MILS),
      size: 9,
      text: "",
      outline: true,
    });
    blocks.push({
      type: "placed",
      x: points(stock.shiftXMils + 4_500),
      y: points(top + MICR_BAND_TOP_MILS + stock.shiftYMils + 200),
      width: points(3_800),
      size: 8,
      alignment: "end",
      text: "MICR band: nothing prints below this line",
    });
    blocks.push(...checkBlocks(stock, SAMPLE_CHECK, top, true));
  }
  if (positions.checks.length === 1) {
    for (const stubTop of positions.stubs) blocks.push(...stubBlocks(stock, SAMPLE_CHECK, stubTop));
  }
  blocks.push({
    type: "placed",
    x: points(500),
    y: points((positions.checks[0] === 0 ? CHECK_HEIGHT_MILS : 0) + 100),
    width: points(7_500),
    size: 8,
    text: "Test page. Print on plain paper, hold it over a blank check against the light, and adjust the stock until every box sits on its line.",
  });
  return { title: "Check test page", language: "en-US", page: LETTER_PAGE, blocks };
}
