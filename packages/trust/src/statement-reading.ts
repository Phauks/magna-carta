import { isValidCalendarDate } from "@magna-carta/ledger/validate";
import { toMinor } from "@magna-carta/money/format";
import { add, fromDecimal, money, type NumberCurrency } from "@magna-carta/money/money";

// READING A BANK STATEMENT from where its words sit on the page. The caller hands over every page as
// positioned pieces of text: a born-digital PDF's glyphs (from the PDF engine's positioned
// extraction) or a scanned page's words (from text recognition, each with the confidence the
// recognizer reported). Nothing here touches a file, a database or the network, so the same pieces
// always read the same way, and a reading can be repeated from the kept pieces without re-running a
// recognizer that does not promise to repeat itself.
//
// What it does, in order:
//   1. pieces become words (a gap wider than a fraction of the text height splits them), and words
//      become rows (pieces whose vertical centres sit within half a line of each other);
//   2. a row that starts with a date and carries money is a statement line; a row with neither,
//      straight after a statement line, continues that line's description; a row naming an
//      opening or closing balance gives that figure;
//   3. a line's money is its amount and, when the statement prints one, the running balance after
//      it. Which way the amount went is read from the column headers when they say so, then from
//      the running balance, then from a printed sign; a line none of those settle is not guessed
//      at, it is rejected with the reason;
//   4. the lines are footed: opening plus every amount against the stated closing balance, and,
//      where running balances were read, the first line whose balance stops agreeing.
//
// A statement that does not foot is still returned in full: the owner ruled on 2026-11-20 that it
// is imported with the error shown rather than refused. It only ever suggests ticks, so a misread
// line is a suggestion a person declines, never a figure in the book.
//
// THE DATE ORDER IS STATED BY THE CALLER, never detected: 03/04 is two different days on two sides
// of an ocean, and a file whose days all happen to exceed twelve would be read one way and the same
// bank's next file the other. A date printed without a year takes the year that puts it on or
// before the period's end.

/** The reader's own version, kept beside what it read so two readings can be told apart. */
export const STATEMENT_READER_VERSION = "statement-reader-1";

/** One piece of text and where it was drawn, in points, with a bottom-left origin (PDF user space). */
export interface StatementPiece {
  readonly text: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** The recognizer's confidence from 0 to 1; absent for a born-digital page's own text. */
  readonly confidence?: number;
}

export type StatementPageSource = "text-layer" | "recognition";

export interface StatementPage {
  /** Zero-based. */
  readonly pageIndex: number;
  readonly source: StatementPageSource;
  readonly pieces: readonly StatementPiece[];
}

export interface ReadStatementOptions {
  readonly currency: NumberCurrency;
  /** How the bank prints a numeric date: 10/03 is October 3 ("month-day") or 10 March ("day-month"). */
  readonly dateOrder: "month-day" | "day-month";
  /** The last day of the period the statement is for, YYYY-MM-DD; gives a year to dates printed without one. */
  readonly periodEnd: string;
}

/** Where on the statement something was read: zero-based page, and the row's place on that page. */
export interface StatementLocation {
  readonly pageIndex: number;
  readonly rowIndex: number;
}

export interface ReadStatementLine extends StatementLocation {
  readonly postedOn: string;
  readonly description: string;
  /** Positive for money in, negative for money out. */
  readonly amountMinor: number;
  /** The balance the statement printed after this line, when it prints one. */
  readonly runningBalanceMinor: number | null;
  readonly source: StatementPageSource;
  /** The lowest recognizer confidence among the line's words; null for a born-digital page. */
  readonly confidence: number | null;
}

export interface StatementRejection extends StatementLocation {
  readonly text: string;
  readonly reason: string;
}

export type StatementFooting =
  | { readonly kind: "foots"; readonly linesTotalMinor: number }
  | {
      readonly kind: "does-not-foot";
      readonly linesTotalMinor: number;
      /** Opening balance plus every line. */
      readonly computedClosingMinor: number;
      readonly statedClosingMinor: number;
      /** Stated minus computed. */
      readonly differenceMinor: number;
      /** The first line whose printed running balance disagrees with the running total, when any do. */
      readonly firstMismatch: StatementLocation | null;
    }
  | { readonly kind: "no-balances"; readonly linesTotalMinor: number };

export interface ReadStatement {
  readonly readerVersion: string;
  readonly openingBalanceMinor: number | null;
  readonly closingBalanceMinor: number | null;
  readonly lines: readonly ReadStatementLine[];
  readonly rejections: readonly StatementRejection[];
  readonly footing: StatementFooting;
}

// ---- words and rows -------------------------------------------------------------------------------

interface Word {
  text: string;
  x0: number;
  x1: number;
  centreY: number;
  height: number;
  confidence: number | null;
}

interface Row {
  words: Word[];
  centreY: number;
  height: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function rowsOf(pieces: readonly StatementPiece[]): Row[] {
  const visible = pieces.filter((piece) => piece.text.trim().length > 0);
  const lineHeight = median(visible.map((piece) => Math.abs(piece.y1 - piece.y0))) || 10;
  // Top of the page first: a larger y is higher up in PDF user space.
  const ordered = [...visible].sort((a, b) => (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2 || a.x0 - b.x0);
  const rows: { pieces: StatementPiece[]; centreY: number }[] = [];
  for (const piece of ordered) {
    const centre = (piece.y0 + piece.y1) / 2;
    const row = rows.at(-1);
    if (row !== undefined && Math.abs(row.centreY - centre) <= lineHeight / 2) {
      row.pieces.push(piece);
    } else {
      rows.push({ pieces: [piece], centreY: centre });
    }
  }
  return rows.map((row) => {
    const sorted = [...row.pieces].sort((a, b) => a.x0 - b.x0);
    const words: Word[] = [];
    for (const piece of sorted) {
      const height = Math.abs(piece.y1 - piece.y0) || lineHeight;
      const last = words.at(-1);
      const gap = last === undefined ? Infinity : piece.x0 - last.x1;
      // A piece that already holds a space (a recognized word list, or a glyph run) splits on it.
      const parts = piece.text.split(/\s+/).filter((part) => part.length > 0);
      if (last !== undefined && gap < height * 0.25 && parts.length === 1) {
        last.text += parts[0];
        last.x1 = Math.max(last.x1, piece.x1);
        if (piece.confidence !== undefined) {
          last.confidence = Math.min(last.confidence ?? 1, piece.confidence);
        }
        continue;
      }
      const width = (piece.x1 - piece.x0) / Math.max(parts.length, 1);
      parts.forEach((part, index) =>
        words.push({
          text: part,
          x0: piece.x0 + width * index,
          x1: piece.x0 + width * (index + 1),
          centreY: (piece.y0 + piece.y1) / 2,
          height,
          confidence: piece.confidence ?? null,
        }),
      );
    }
    return { words, centreY: row.centreY, height: lineHeight };
  });
}

// ---- tokens ---------------------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// A money figure as a statement prints one: an optional currency sign, thousands separators, exactly
// two decimals, and a sign written as a leading minus, a trailing minus, parentheses, or CR/DR.
const MONEY = /^(\(?)(-?)\$?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(-?)(\)?)(CR|DR)?$/i;

interface MoneyToken {
  minor: number;
  /** -1 when printed negative or as a debit, 1 when printed as a credit, 0 when unsigned. */
  sign: -1 | 0 | 1;
  x1: number;
}

function moneyToken(word: Word, currency: NumberCurrency): MoneyToken | null {
  const match = MONEY.exec(word.text);
  if (match === null) return null;
  const [, open, minus, whole, cents, trailing, close, marker] = match;
  if ((open === "(") !== (close === ")")) return null;
  const minor = toMinor(fromDecimal(`${(whole ?? "").replace(/,/g, "")}.${cents}`, currency));
  const negative = open === "(" || minus === "-" || trailing === "-" || /^dr$/i.test(marker ?? "");
  const credit = /^cr$/i.test(marker ?? "");
  return { minor, sign: negative ? -1 : credit ? 1 : 0, x1: word.x1 };
}

function dateOf(
  words: readonly Word[],
  options: ReadStatementOptions,
): { date: string; used: number } | null {
  const first = words[0]?.text ?? "";
  const periodYear = Number(options.periodEnd.slice(0, 4));
  const withYear = (month: number, day: number, year: number | null): string | null => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const candidate = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
    if (year !== null) return isValidCalendarDate(candidate(year)) ? candidate(year) : null;
    // No year printed: the year that puts the date on or before the period's end.
    const same = candidate(periodYear);
    if (isValidCalendarDate(same) && same <= options.periodEnd) return same;
    const before = candidate(periodYear - 1);
    return isValidCalendarDate(before) ? before : null;
  };
  const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(first);
  if (numeric !== null) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const yearText = numeric[3];
    const year =
      yearText === undefined
        ? null
        : yearText.length === 2
          ? 2000 + Number(yearText)
          : Number(yearText);
    const [month, day] = options.dateOrder === "month-day" ? [a, b] : [b, a];
    const date = withYear(month, day, year);
    return date === null ? null : { date, used: 1 };
  }
  const monthIndex = MONTHS.indexOf(first.slice(0, 3).toLowerCase());
  const dayText = words[1]?.text.replace(/,$/, "") ?? "";
  if (monthIndex >= 0 && /^\d{1,2}$/.test(dayText)) {
    const yearText = words[2]?.text ?? "";
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    const date = withYear(monthIndex + 1, Number(dayText), year);
    return date === null ? null : { date, used: year === null ? 2 : 3 };
  }
  return null;
}

// ---- columns --------------------------------------------------------------------------------------

type ColumnRole = "deposit" | "withdrawal" | "balance" | "amount";

const HEADER_ROLES: readonly [RegExp, ColumnRole][] = [
  [/^(deposits?|credits?|additions?)$/i, "deposit"],
  [/^(withdrawals?|debits?|checks?|subtractions?|payments?)$/i, "withdrawal"],
  [/^balance$/i, "balance"],
  [/^amount$/i, "amount"],
];

interface HeaderColumn {
  role: ColumnRole;
  centre: number;
}

function headerColumns(row: Row): HeaderColumn[] {
  const found: HeaderColumn[] = [];
  for (const word of row.words) {
    const role = HEADER_ROLES.find(([pattern]) =>
      pattern.test(word.text.replace(/[:.]$/, "")),
    )?.[1];
    if (role !== undefined && !found.some((column) => column.role === role)) {
      found.push({ role, centre: (word.x0 + word.x1) / 2 });
    }
  }
  return found.length >= 2 ? found : [];
}

function nearestRole(columns: readonly HeaderColumn[], x: number): ColumnRole | null {
  let best: HeaderColumn | null = null;
  for (const column of columns) {
    if (best === null || Math.abs(column.centre - x) < Math.abs(best.centre - x)) best = column;
  }
  return best?.role ?? null;
}

// ---- reading --------------------------------------------------------------------------------------

const OPENING = /\b(beginning|opening|previous|starting)\s+balance\b/i;
const CLOSING = /\b(ending|closing|new)\s+balance\b/i;

interface PendingLine {
  location: StatementLocation;
  postedOn: string;
  description: string[];
  money: MoneyToken[];
  roles: (ColumnRole | null)[];
  source: StatementPageSource;
  confidence: number | null;
  text: string;
}

export function readStatement(
  pages: readonly StatementPage[],
  options: ReadStatementOptions,
): ReadStatement {
  let opening: number | null = null;
  let closing: number | null = null;
  const pending: PendingLine[] = [];
  const rejections: StatementRejection[] = [];
  let columns: HeaderColumn[] = [];

  for (const page of pages) {
    const rows = rowsOf(page.pieces);
    let previous: PendingLine | null = null;
    rows.forEach((row, rowIndex) => {
      const text = row.words.map((word) => word.text).join(" ");
      const location = { pageIndex: page.pageIndex, rowIndex };
      const header = headerColumns(row);
      if (header.length > 0) {
        columns = header;
        previous = null;
        return;
      }
      const tokens = row.words
        .map((word) => moneyToken(word, options.currency))
        .filter((token): token is MoneyToken => token !== null);
      if (OPENING.test(text) && tokens.length > 0 && opening === null) {
        const token = tokens.at(-1)!;
        opening = token.sign === -1 ? -token.minor : token.minor;
        previous = null;
        return;
      }
      if (CLOSING.test(text) && tokens.length > 0) {
        const token = tokens.at(-1)!;
        closing = token.sign === -1 ? -token.minor : token.minor;
        previous = null;
        return;
      }
      const date = dateOf(row.words, options);
      if (date === null) {
        // A row with no date and no money straight after a line is the rest of its description.
        if (previous !== null && tokens.length === 0) previous.description.push(text);
        else previous = null;
        return;
      }
      if (tokens.length === 0) {
        // A dated row with no money: a heading, or a line whose amount sits on the next row. Not guessed.
        previous = null;
        return;
      }
      const moneyWords = new Set(
        row.words.filter((word) => moneyToken(word, options.currency) !== null),
      );
      const description = row.words
        .slice(date.used)
        .filter((word) => !moneyWords.has(word))
        .map((word) => word.text)
        .join(" ");
      const confidences = row.words
        .map((word) => word.confidence)
        .filter((value): value is number => value !== null);
      const line: PendingLine = {
        location,
        postedOn: date.date,
        description: [description],
        money: tokens,
        roles: tokens.map((token) => (columns.length > 0 ? nearestRole(columns, token.x1) : null)),
        source: page.source,
        confidence: confidences.length === 0 ? null : Math.min(...confidences),
        text,
      };
      pending.push(line);
      previous = line;
    });
  }

  // The running-balance column: named by a header, or the rightmost figure when every line with two
  // or more figures ends in one. Only then can a balance settle which way an unsigned amount went.
  const hasBalanceColumn =
    columns.some((column) => column.role === "balance") ||
    (pending.length > 1 && pending.every((line) => line.money.length >= 2));

  const lines: ReadStatementLine[] = [];
  let runningBalance: number | null = opening;
  for (const line of pending) {
    const balanceIndex = hasBalanceColumn
      ? line.roles.includes("balance")
        ? line.roles.indexOf("balance")
        : line.money.length - 1
      : -1;
    const balanceToken = balanceIndex >= 0 ? line.money[balanceIndex] : undefined;
    const amounts = line.money.filter((_, index) => index !== balanceIndex);
    const amountRoles = line.roles.filter((_, index) => index !== balanceIndex);
    const reject = (reason: string) =>
      rejections.push({ ...line.location, text: line.text, reason });
    if (amounts.length !== 1) {
      reject(
        amounts.length === 0
          ? "this line carries no amount apart from its balance"
          : "this line carries more than one amount, so which one moved the money is not clear",
      );
      continue;
    }
    const amount = amounts[0]!;
    const balance =
      balanceToken === undefined
        ? null
        : balanceToken.sign === -1
          ? -balanceToken.minor
          : balanceToken.minor;
    const role = amountRoles[0] ?? null;
    let direction: 1 | -1 | null = null;
    if (role === "deposit") direction = 1;
    else if (role === "withdrawal") direction = -1;
    else if (amount.sign !== 0) direction = amount.sign;
    else if (balance !== null && runningBalance !== null) {
      if (runningBalance + amount.minor === balance) direction = 1;
      else if (runningBalance - amount.minor === balance) direction = -1;
    }
    if (direction === null) {
      reject("whether this line is money in or money out is not printed on the statement");
      if (balance !== null) runningBalance = balance;
      continue;
    }
    const amountMinor = direction * amount.minor;
    if (runningBalance !== null) runningBalance += amountMinor;
    if (balance !== null) runningBalance = runningBalance ?? balance;
    lines.push({
      ...line.location,
      postedOn: line.postedOn,
      description: line.description.join(" ").replace(/\s+/g, " ").trim(),
      amountMinor,
      runningBalanceMinor: balance,
      source: line.source,
      confidence: line.confidence,
    });
  }

  return {
    readerVersion: STATEMENT_READER_VERSION,
    openingBalanceMinor: opening,
    closingBalanceMinor: closing,
    lines,
    rejections,
    footing: footingOf(lines, opening, closing, options.currency),
  };
}

function footingOf(
  lines: readonly ReadStatementLine[],
  opening: number | null,
  closing: number | null,
  currency: NumberCurrency,
): StatementFooting {
  const sum = (values: readonly number[]): number =>
    toMinor(
      values.reduce((total, value) => add(total, money(value, currency)), money(0, currency)),
    );
  const linesTotalMinor = sum(lines.map((line) => line.amountMinor));
  if (opening === null || closing === null) return { kind: "no-balances", linesTotalMinor };
  const computedClosingMinor = sum([opening, linesTotalMinor]);
  if (computedClosingMinor === closing) return { kind: "foots", linesTotalMinor };
  let running = opening;
  let firstMismatch: StatementLocation | null = null;
  for (const line of lines) {
    running = sum([running, line.amountMinor]);
    if (line.runningBalanceMinor !== null && line.runningBalanceMinor !== running) {
      firstMismatch = { pageIndex: line.pageIndex, rowIndex: line.rowIndex };
      break;
    }
  }
  return {
    kind: "does-not-foot",
    linesTotalMinor,
    computedClosingMinor,
    statedClosingMinor: closing,
    differenceMinor: sum([closing, -computedClosingMinor]),
    firstMismatch,
  };
}
