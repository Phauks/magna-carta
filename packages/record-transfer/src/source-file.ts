import type { TransferRunId, TransferSourceFileId } from "@magna-carta/identifiers/types";

// The vocabulary of a file a transfer is given: what it holds, how it is read, and where its bytes
// are kept. The file itself is the staging store. It is held unchanged in the firm's object storage
// and read into numbered rows the same way every time, so nothing of its content is copied into the
// firm's database.

// What a file holds (`matter-list`) and how it is read (`delimited-text`) are lower-case slugs, open
// text in the database and constrained here, for the same reason a source system is.
const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export class InvalidSourceFileSlugError extends Error {
  constructor(part: "sourceKind" | "format", value: string) {
    super(
      `"${value}" is not a ${part}: use a lower-case slug (letters, digits and hyphens, starting with a letter).`,
    );
    this.name = "InvalidSourceFileSlugError";
  }
}

export function assertSourceFileKind(value: string): string {
  if (!SLUG_PATTERN.test(value)) throw new InvalidSourceFileSlugError("sourceKind", value);
  return value;
}

// The formats a reader exists for. A new reader adds its name here, and a file registered under any
// other format is refused before the database is asked, because a file nothing can read is not
// staged, it is only stored.
export const SOURCE_FILE_FORMATS = ["delimited-text"] as const;

export type SourceFileFormat = (typeof SOURCE_FILE_FORMATS)[number];

export class UnreadableSourceFileFormatError extends Error {
  constructor(value: string) {
    super(
      `"${value}" is not a format a reader exists for. Readers exist for: ${SOURCE_FILE_FORMATS.join(", ")}.`,
    );
    this.name = "UnreadableSourceFileFormatError";
  }
}

export function assertSourceFileFormat(value: string): SourceFileFormat {
  if (!(SOURCE_FILE_FORMATS as readonly string[]).includes(value)) {
    throw new UnreadableSourceFileFormatError(value);
  }
  return value as SourceFileFormat;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export class InvalidContentDigestError extends Error {
  constructor() {
    super("a source file's content digest is 64 lower-case hexadecimal characters (SHA-256).");
    this.name = "InvalidContentDigestError";
  }
}

export function assertContentSha256(value: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) throw new InvalidContentDigestError();
  return value;
}

// Where a source file's bytes are kept. Built from the two identifiers alone and never from the
// file's own name, which is whatever a person's computer called it and may carry a client's name.
export function transferSourceFileObjectKey(
  transferRunId: TransferRunId,
  transferSourceFileId: TransferSourceFileId,
): string {
  return `transfers/${transferRunId}/${transferSourceFileId}`;
}

// One row of a source file as a reader hands it on: its position and its values, uninterpreted.
// `rowNumber` counts data rows from 1 and is what a link, a rejection and the run's report cite.
// `lineNumber` is the line of the file the row starts on, which is what a person opening the file in
// a spreadsheet or an editor needs, and differs from the row number as soon as a value holds a line
// break.
export interface SourceFileRow {
  readonly rowNumber: number;
  readonly lineNumber: number;
  readonly values: readonly string[];
}

// Why a row could not be laid against the file's header. A reader reports it and carries on: a
// ragged row is a finding for the run's report, never a reason to stop reading the file.
export type SourceFileRowFault = "tooFewValues" | "tooManyValues";

export type SourceFileRowFields =
  | { readonly ok: true; readonly fields: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly fault: SourceFileRowFault };

// Lay a row's values against the header. Exact or nothing: a short row is not padded and a long one
// is not trimmed, because either would put a value under a column it did not arrive in.
export function sourceFileRowFields(
  header: readonly string[],
  row: SourceFileRow,
): SourceFileRowFields {
  if (row.values.length < header.length) return { ok: false, fault: "tooFewValues" };
  if (row.values.length > header.length) return { ok: false, fault: "tooManyValues" };
  const fields = new Map<string, string>();
  for (const [index, name] of header.entries()) {
    fields.set(name, row.values[index] ?? "");
  }
  return { ok: true, fields };
}

export class UnknownKeyColumnError extends Error {
  constructor(keyColumn: string) {
    super(`the file has no column named "${keyColumn}", so it cannot be the key column.`);
    this.name = "UnknownKeyColumnError";
  }
}

// The source system's key for a row: the value under the file's key column, verbatim. Null when the
// value is empty, which a mapper treats as a row it cannot link and reports.
export function sourceIdOfRow(
  header: readonly string[],
  keyColumn: string,
  row: SourceFileRow,
): string | null {
  const index = header.indexOf(keyColumn);
  if (index < 0) throw new UnknownKeyColumnError(keyColumn);
  const value = row.values[index];
  return value === undefined || value === "" ? null : value;
}
