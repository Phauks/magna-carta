import type { SourceFileRow } from "./source-file.ts";

// The reader for delimited text: a report or an extract saved as comma-, tab- or semicolon-separated
// values with a header row. It follows RFC 4180's quoting (a value in double quotes may hold the
// delimiter, a line break, and a doubled quote standing for one quote) and accepts either line
// ending.
//
// It interprets nothing. A value is the characters between two delimiters, exactly: not trimmed, not
// parsed as a number or a date, not treated as empty because it reads "NULL". What a value means is
// the mapping rules' question, asked later and answerable again from the same file.
//
// It reads text as it arrives and holds one row at a time, so the size of a file is not a limit on
// reading it.

export type DelimitedTextFault =
  | "noHeader" // the file is empty, or holds nothing but blank lines
  | "blankColumnName" // a header cell is empty, so its values would have no name
  | "duplicateColumnName" // two header cells are the same, so one name would mean two columns
  | "unterminatedQuote"; // the file ends inside a quoted value: it was cut short

// A file-level fault: the file cannot be read as rows at all. Distinct from a ragged row, which is
// read and reported. `lineNumber` is where the fault was noticed.
export class DelimitedTextError extends Error {
  readonly fault: DelimitedTextFault;
  readonly lineNumber: number;

  constructor(fault: DelimitedTextFault, lineNumber: number) {
    super(DELIMITED_TEXT_FAULT_PHRASING[fault]);
    this.name = "DelimitedTextError";
    this.fault = fault;
    this.lineNumber = lineNumber;
  }
}

// Fixed wording, one sentence per fault, holding nothing from the file. A header cell or a value
// never appears in a message, because a message is logged and a file's content is not.
const DELIMITED_TEXT_FAULT_PHRASING: Readonly<Record<DelimitedTextFault, string>> = {
  noHeader: "The file has no header row.",
  blankColumnName: "A column in the header row has no name.",
  duplicateColumnName: "Two columns in the header row have the same name.",
  unterminatedQuote: "The file ends inside a quoted value, so it is incomplete.",
};

export type DelimitedTextEvent =
  | { readonly kind: "header"; readonly columns: readonly string[] }
  | { readonly kind: "row"; readonly row: SourceFileRow };

export interface DelimitedTextOptions {
  // One character. A comma unless the file says otherwise.
  readonly delimiter?: "," | "\t" | ";" | "|";
}

const BYTE_ORDER_MARK = "﻿";

// Read delimited text into one header event followed by a row event per data row.
//
// A line with nothing on it is skipped, which is what a spreadsheet's export leaves at the end of a
// file. A line of delimiters alone is a row of empty values and is kept, because the source wrote it.
export async function* readDelimitedText(
  chunks: AsyncIterable<string> | Iterable<string>,
  options: DelimitedTextOptions = {},
): AsyncGenerator<DelimitedTextEvent> {
  const delimiter = options.delimiter ?? ",";

  let values: string[] = [];
  let value = "";
  let quoted = false; // inside a quoted value
  let valueWasQuoted = false; // the current value opened with a quote, so "" is a value and not a blank line
  let pendingQuote = false; // saw a quote inside a quoted value; the next character decides what it was
  let pendingCarriageReturn = false; // saw \r outside quotes; a following \n belongs to the same line ending
  let lineNumber = 1; // the line being read
  let recordLineNumber = 1; // the line the current record started on
  let headerSeen = false;
  let rowNumber = 0;
  let firstCharacter = true;

  function* endRecord(): Generator<DelimitedTextEvent> {
    const blankLine = values.length === 0 && value === "" && !valueWasQuoted;
    if (!blankLine) {
      values.push(value);
      if (headerSeen) {
        rowNumber += 1;
        yield { kind: "row", row: { rowNumber, lineNumber: recordLineNumber, values } };
      } else {
        yield { kind: "header", columns: checkedHeader(values, recordLineNumber) };
        headerSeen = true;
      }
    }
    values = [];
    value = "";
    valueWasQuoted = false;
  }

  for await (const chunk of chunks) {
    for (const character of chunk) {
      if (firstCharacter) {
        firstCharacter = false;
        if (character === BYTE_ORDER_MARK) continue;
      }

      if (pendingQuote) {
        pendingQuote = false;
        if (character === '"') {
          value += '"';
          continue;
        }
        quoted = false; // the quote closed the value; this character is read as ordinary text below
      }

      if (quoted) {
        if (character === '"') {
          pendingQuote = true;
        } else {
          if (character === "\n") lineNumber += 1;
          value += character;
        }
        continue;
      }

      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        if (character === "\n") continue; // the second half of a \r\n already handled
      }

      if (character === '"' && value === "" && !valueWasQuoted) {
        quoted = true;
        valueWasQuoted = true;
      } else if (character === delimiter) {
        values.push(value);
        value = "";
        valueWasQuoted = false;
      } else if (character === "\n" || character === "\r") {
        yield* endRecord();
        pendingCarriageReturn = character === "\r";
        lineNumber += 1;
        recordLineNumber = lineNumber;
      } else {
        value += character;
      }
    }
  }

  // A quote still open at the end, with no closing quote seen, means the file was cut short. A
  // pending quote is a closing quote that happened to be the file's last character.
  if (quoted && !pendingQuote) throw new DelimitedTextError("unterminatedQuote", recordLineNumber);
  yield* endRecord();
  if (!headerSeen) throw new DelimitedTextError("noHeader", 1);
}

function checkedHeader(columns: readonly string[], lineNumber: number): readonly string[] {
  const seen = new Set<string>();
  for (const column of columns) {
    if (column.trim() === "") throw new DelimitedTextError("blankColumnName", lineNumber);
    if (seen.has(column)) throw new DelimitedTextError("duplicateColumnName", lineNumber);
    seen.add(column);
  }
  return columns;
}
