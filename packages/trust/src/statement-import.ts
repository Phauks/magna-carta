import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { TrustAccountId, TrustBankStatementId, UserId } from "@magna-carta/identifiers/types";
import { isValidCalendarDate } from "@magna-carta/ledger/validate";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { fromDecimal, type Money, type NumberCurrency } from "@magna-carta/money/money";
import type { TrustServiceOptions } from "./account-tree.ts";
import {
  composeTrustBankStatement,
  MAX_TRUST_BANK_STATEMENT_LINES,
  type ComposedTrustBankStatement,
} from "./bank-statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustBankStatementLineDirection,
  TrustStatementImportPreview,
  TrustStatementImportRejection,
  TrustStatementImportReport,
  TrustStatementImportRow,
} from "./types.ts";

// Importing a bank statement from a file the firm exported from its bank, under the platform's
// standing posture for turning a firm's own material into platform data: detection and reporting are
// always on, the storing of anything is a separate explicit act, and the product says what it found,
// what each row would become, and what it cannot carry across — before the decision and again after
// the run. `docs/conventions/documentation.md` is not where that posture lives; it binds the whole
// product, and this module is the trust subsystem's instance of it.
//
// Concretely, in this order:
//
//   preview    parses the file and REPORTS — the column mapping it resolved, every row it could
//              read, every row it could not and why, the totals, and the period the rows span.
//              It writes nothing, touches no database, and is safe to run on a file the firm has
//              not decided about.
//   confirm    takes that preview's fingerprint back. Re-parsing the same text must produce the
//              same fingerprint or the confirmation is refused, so a person can never approve one
//              file and have a different one stored.
//   report     says what was actually recorded.
//
// TWO THINGS IT DELIBERATELY WILL NOT GUESS. A date it cannot read in the format the caller stated
// is a rejected row, never a date reinterpreted under another convention — 03/04/2026 is two
// different days on two sides of an ocean, and a reconciliation built on the wrong one is wrong in a
// way nobody will notice. And a column it cannot recognize is a refusal naming the headers it found,
// never a positional guess at which column held the money.

// The date conventions a caller may STATE. There is no detection: a file of dates that all happen to
// have a day past the twelfth would be read one way and the same bank's next file the other.
export const TRUST_STATEMENT_DATE_FORMATS = ["iso", "month-day-year", "day-month-year"] as const;
export type TrustStatementDateFormat = (typeof TRUST_STATEMENT_DATE_FORMATS)[number];

export interface TrustStatementImportOptions {
  // Defaults to ISO, which is the only one that is unambiguous on its face.
  readonly dateFormat?: TrustStatementDateFormat;
  readonly currency: NumberCurrency;
}

// Header aliases, normalized to lowercase words. A bank that spells a column something else is a
// mapping this table gains, not a positional guess this parser makes.
const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  postedOn: ["date", "posted date", "posting date", "post date", "transaction date", "posted on"],
  description: ["description", "memo", "details", "narrative", "transaction description", "detail"],
  amount: ["amount", "transaction amount", "value"],
  deposit: ["deposit", "credit", "credits", "money in", "paid in"],
  withdrawal: ["withdrawal", "withdrawl", "debit", "debits", "money out", "paid out"],
  reference: ["reference", "ref", "check number", "check no", "cheque number", "check"],
  counterparty: ["payee", "counterparty", "payer", "name", "merchant", "beneficiary"],
};

function normalizeHeader(header: string): string {
  return header
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

// RFC 4180 in the shape files actually arrive in: comma-separated, optional double quotes, a doubled
// quote inside a quoted field, and either line ending. Written here rather than taken as a
// dependency because it is thirty lines and a bank statement is privileged material — the fewer
// third-party parsers it passes through, the better.
export function parseDelimitedRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  // A byte-order mark on a file exported from a spreadsheet would otherwise become part of the
  // first header, and the column mapping would fail on a file that looks correct to a person.
  const source = text.startsWith("﻿") ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty final row, which is not a record of anything.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const character = source[index] as string;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ",") {
      endField();
      index += 1;
      continue;
    }
    if (character === "\n") {
      endRow();
      index += 1;
      continue;
    }
    if (character === "\r") {
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

// A cleanup, not a conversion: currency symbols, thousands separators, and the accounting
// convention of parentheses for a negative are removed so the remaining text is a plain decimal
// number. Nothing here decides what a value MEANS — an unreadable amount stays unreadable and its
// row is rejected.
function normalizeAmountText(text: string): string {
  const trimmed = text.trim();
  const negated = /^\(.*\)$/.test(trimmed);
  const bare = trimmed
    .replace(/^\(|\)$/g, "")
    .replace(/[^0-9.,+-]/g, "")
    .replace(/,/g, "")
    .replace(/^\+/, "");
  return negated ? `-${bare.replace(/^-/, "")}` : bare;
}

// Every branch ends at `isValidCalendarDate`, the ledger's own check, rather than at a shape test.
// A month-and-day range test accepts 2026-02-31 and 2026-04-31, which are not days: stored, such a
// line is compared to the period bounds lexically (so it lands inside the period), and then
// `dayGapBetween` in matching.ts parses it to NaN, scores every candidate at infinite distance, and
// the line sits unmatched forever with nothing saying why.
function parseCivilDate(text: string, format: TrustStatementDateFormat): string | null {
  const trimmed = text.trim();
  if (format === "iso") {
    return isValidCalendarDate(trimmed) ? trimmed : null;
  }
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [, first, second, year] = match as unknown as [string, string, string, string];
  const month = format === "month-day-year" ? first : second;
  const day = format === "month-day-year" ? second : first;
  const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidCalendarDate(isoDate) ? isoDate : null;
}

// Identifies exactly these parsed rows so a confirmation cannot be attached to a different file. It
// is a fingerprint and not a signature: it detects a substituted or edited file between the preview
// and the confirmation, which is the mistake this flow is actually guarding against.
//
// Every field of a row is written into the canonical text as `<character length>:<text>`, which is
// what makes that text UNAMBIGUOUS rather than merely reproducible: a reader has exactly one way to
// cut it back into fields, so no two different sets of fields can produce the same string.
//
// A separator character cannot do that job here. A description, a reference, and a counterparty name
// are whatever the firm's institution wrote into the file, and this parser passes every character of
// them through — including the control characters a separator would have to reserve. Any file
// carrying the separator byte inside a field is a file whose canonical text can be cut in two places,
// and one of those cuttings is a set of fields nobody supplied: a figure that shifted across a field
// boundary — amount 23 beside description "45 ACME" against amount 2345 beside description " ACME" —
// is exactly the edit that reproduces the fingerprint the preview already returned. The length
// prefix removes the reservation, and with it the class of edit it could not see.
function fingerprintOf(rows: readonly TrustStatementImportRow[]): string {
  const lengthPrefixed = (value: string | number | null): string => {
    const text = value === null ? "" : String(value);
    return `${text.length}:${text}`;
  };
  const canonical = rows
    .map((row) =>
      [
        lengthPrefixed(row.rowNumber),
        lengthPrefixed(row.postedOn),
        lengthPrefixed(row.direction),
        lengthPrefixed(row.amountMinor),
        lengthPrefixed(row.description),
        lengthPrefixed(row.reference),
        lengthPrefixed(row.counterpartyName),
      ].join(""),
    )
    .join("");
  // FNV-1a, 32 bits, over the canonical text plus its length — enough to catch an edited file, and
  // deliberately not presented as anything stronger.
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${rows.length.toString(16)}-${hash.toString(16).padStart(8, "0")}`;
}

interface ColumnMapping {
  readonly postedOn: number;
  readonly description: number;
  readonly amount: number | null;
  readonly deposit: number | null;
  readonly withdrawal: number | null;
  readonly reference: number | null;
  readonly counterparty: number | null;
}

function resolveColumns(headers: readonly string[]): {
  mapping: ColumnMapping;
  report: Record<string, string>;
} {
  const normalized = headers.map(normalizeHeader);
  const find = (key: keyof typeof HEADER_ALIASES): number | null => {
    const aliases = HEADER_ALIASES[key] ?? [];
    const index = normalized.findIndex((header) => aliases.includes(header));
    return index === -1 ? null : index;
  };
  const postedOn = find("postedOn");
  const description = find("description");
  const amount = find("amount");
  const deposit = find("deposit");
  const withdrawal = find("withdrawal");
  const reference = find("reference");
  const counterparty = find("counterparty");

  const hasMoneyColumn = amount !== null || deposit !== null || withdrawal !== null;
  if (postedOn === null || description === null || !hasMoneyColumn) {
    throw new TrustValidationError(
      "statement-import-columns-unrecognized",
      `this file needs a date column, a description column, and either an amount column or separate deposit and withdrawal columns; the headers found were: ${headers.join(", ")}`,
    );
  }

  const report: Record<string, string> = {
    postedOn: headers[postedOn] as string,
    description: headers[description] as string,
  };
  if (amount !== null) report["amount"] = headers[amount] as string;
  if (deposit !== null) report["deposit"] = headers[deposit] as string;
  if (withdrawal !== null) report["withdrawal"] = headers[withdrawal] as string;
  if (reference !== null) report["reference"] = headers[reference] as string;
  if (counterparty !== null) report["counterparty"] = headers[counterparty] as string;

  return {
    mapping: { postedOn, description, amount, deposit, withdrawal, reference, counterparty },
    report,
  };
}

interface ParsedAmount {
  readonly direction: TrustBankStatementLineDirection;
  readonly amountMinor: number;
}

function parseRowAmount(
  cells: readonly string[],
  mapping: ColumnMapping,
  currency: NumberCurrency,
): ParsedAmount | string {
  const readMoney = (index: number): number | string => {
    const text = normalizeAmountText(cells[index] ?? "");
    if (text.length === 0) return "empty";
    try {
      return toMinor(fromDecimal(text, currency));
    } catch {
      return `the amount "${cells[index] ?? ""}" is not a number this platform can store without rounding it`;
    }
  };

  if (mapping.amount !== null) {
    const value = readMoney(mapping.amount);
    if (typeof value === "string") {
      return value === "empty" ? "this row carries no amount" : value;
    }
    if (value === 0) return "this row's amount is zero, so there is nothing to reconcile";
    return {
      direction: value > 0 ? "deposit" : "withdrawal",
      amountMinor: Math.abs(value),
    };
  }

  // Separate columns: exactly one of them carries the money. A row with a figure in both is a shape
  // nobody can read confidently, so it is reported rather than resolved by a rule this file invented.
  const deposit = mapping.deposit === null ? "empty" : readMoney(mapping.deposit);
  const withdrawal = mapping.withdrawal === null ? "empty" : readMoney(mapping.withdrawal);
  const depositMinor = typeof deposit === "number" ? deposit : 0;
  const withdrawalMinor = typeof withdrawal === "number" ? withdrawal : 0;
  if (typeof deposit === "string" && deposit !== "empty") return deposit;
  if (typeof withdrawal === "string" && withdrawal !== "empty") return withdrawal;
  if (depositMinor !== 0 && withdrawalMinor !== 0) {
    return "this row carries a figure in both the deposit and the withdrawal column";
  }
  if (depositMinor === 0 && withdrawalMinor === 0) return "this row carries no amount";
  return depositMinor !== 0
    ? { direction: "deposit", amountMinor: Math.abs(depositMinor) }
    : { direction: "withdrawal", amountMinor: Math.abs(withdrawalMinor) };
}

// STAGE ONE, and the one that always runs. It reads the file and says what is in it; it stores
// nothing, and running it is not a decision to import anything.
export function previewTrustStatementImport(
  text: string,
  options: TrustStatementImportOptions,
): TrustStatementImportPreview {
  const format = options.dateFormat ?? "iso";
  const rows = parseDelimitedRows(text);
  const headerRow = rows[0];
  if (!headerRow) {
    throw new TrustValidationError(
      "statement-import-columns-unrecognized",
      "this file has no header row, so there is no way to tell which column holds what",
    );
  }
  const { mapping, report } = resolveColumns(headerRow);

  const parsed: TrustStatementImportRow[] = [];
  const rejections: TrustStatementImportRejection[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    // Numbered as a person's spreadsheet numbers them, header included, because the person fixing a
    // rejected row is looking at that file rather than at this list.
    const rowNumber = index + 1;
    const cells = rows[index] as string[];
    if (cells.every((cell) => cell.trim().length === 0)) continue;

    const postedOn = parseCivilDate(cells[mapping.postedOn] ?? "", format);
    if (postedOn === null) {
      rejections.push({
        rowNumber,
        reason: `the date "${(cells[mapping.postedOn] ?? "").trim()}" is not readable as ${format}; nothing here reinterprets a date under another convention`,
      });
      continue;
    }
    const description = (cells[mapping.description] ?? "").trim();
    if (description.length === 0) {
      rejections.push({ rowNumber, reason: "this row has no description" });
      continue;
    }
    const amount = parseRowAmount(cells, mapping, options.currency);
    if (typeof amount === "string") {
      rejections.push({ rowNumber, reason: amount });
      continue;
    }
    const reference =
      mapping.reference === null ? null : (cells[mapping.reference] ?? "").trim() || null;
    const counterpartyName =
      mapping.counterparty === null ? null : (cells[mapping.counterparty] ?? "").trim() || null;
    parsed.push({
      rowNumber,
      postedOn,
      direction: amount.direction,
      amountMinor: amount.amountMinor,
      description,
      reference,
      counterpartyName,
    });

    // The ceiling is applied HERE, as rows are built, not after the whole file has been parsed and
    // materialized. A file with a million rows is refused after the first 2,001 rather than being
    // read end to end first — this runs on a request path, and a refusal that costs as much as an
    // acceptance is not a refusal. The count is the readable rows, so a file that is mostly
    // unparseable is still described honestly by the rejections it earns.
    if (parsed.length > MAX_TRUST_BANK_STATEMENT_LINES) {
      throw new TrustValidationError(
        "statement-too-many-lines",
        `this file holds more than ${MAX_TRUST_BANK_STATEMENT_LINES} readable rows; a single statement records at most that many`,
      );
    }
  }

  const dates = parsed.map((row) => row.postedOn).sort();
  return {
    columnMapping: report,
    rows: parsed,
    rejections,
    depositTotalMinor: parsed
      .filter((row) => row.direction === "deposit")
      .reduce((total, row) => total + row.amountMinor, 0),
    withdrawalTotalMinor: parsed
      .filter((row) => row.direction === "withdrawal")
      .reduce((total, row) => total + row.amountMinor, 0),
    earliestPostedOn: dates[0] ?? null,
    latestPostedOn: dates[dates.length - 1] ?? null,
    fingerprint: fingerprintOf(parsed),
  };
}

export interface ConfirmTrustStatementImportInput {
  readonly trustAccountId: TrustAccountId;
  readonly periodStart: string;
  readonly periodEnd: string;
  // Signed: an imported statement records an overdrawn closing balance as readily as a healthy one.
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly statementReference?: string | null;
  readonly supersedesStatementId?: TrustBankStatementId | null;
  // The file, verbatim, as it was previewed. It is re-parsed here rather than trusted from the
  // preview, so what is stored is what the file says and not what a client sent back.
  readonly fileText: string;
  // The fingerprint the preview returned. A different one means the file changed between looking
  // and agreeing, and the import is refused rather than silently storing the newer file.
  readonly confirmedFingerprint: string;
  readonly recordedBy: UserId;
}

export interface ConfirmedTrustStatementImport extends ComposedTrustBankStatement {
  readonly report: TrustStatementImportReport;
}

// STAGE TWO, which only ever runs because somebody asked for it. Nothing about uploading or
// previewing a file reaches this function.
export async function confirmTrustStatementImport(
  database: SqlDatabase,
  input: ConfirmTrustStatementImportInput,
  options: TrustServiceOptions & TrustStatementImportOptions,
): Promise<ConfirmedTrustStatementImport> {
  const preview = previewTrustStatementImport(input.fileText, options);
  if (preview.fingerprint !== input.confirmedFingerprint) {
    throw new TrustValidationError(
      "statement-import-preview-mismatch",
      `this file no longer matches the one that was reviewed (reviewed ${input.confirmedFingerprint}, supplied ${preview.fingerprint}); preview it again before importing`,
    );
  }
  if (preview.rows.length === 0) {
    throw new TrustValidationError(
      "statement-import-nothing-to-record",
      `no row in this file could be read, so there is nothing to record; ${preview.rejections.length} row(s) were rejected`,
    );
  }

  const composed = await composeTrustBankStatement(
    database,
    {
      trustAccountId: input.trustAccountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      openingBalance: input.openingBalance,
      closingBalance: input.closingBalance,
      statementReference: input.statementReference ?? null,
      source: "imported",
      supersedesStatementId: input.supersedesStatementId ?? null,
      lines: preview.rows.map((row) => ({
        postedOn: row.postedOn,
        direction: row.direction,
        amount: fromMinor(row.amountMinor, options.currency),
        description: row.description,
        reference: row.reference,
        counterpartyName: row.counterpartyName,
        sourceRowNumber: row.rowNumber,
      })),
      recordedBy: input.recordedBy,
    },
    options,
  );

  // STAGE THREE: what actually happened, reported back. The rejected rows are counted here as well
  // as in the preview, because the person who confirmed and the person who reads the result are
  // frequently not the same person.
  return {
    ...composed,
    report: {
      statementId: composed.statementId,
      linesRecorded: composed.lineIds.length,
      rowsRejected: preview.rejections.length,
      depositTotalMinor: preview.depositTotalMinor,
      withdrawalTotalMinor: preview.withdrawalTotalMinor,
    },
  };
}
