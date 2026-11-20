import type { DelimitedTextEvent, DelimitedTextOptions } from "./delimited-text-reader.ts";

// The rows a pass rejected, given back in the file's own shape: the same header, the same values,
// the same delimiter, with one column in front saying why each row made no record. A person corrects
// those rows in a spreadsheet and gives the result back as a new file, or corrects the source and
// exports again.
//
// The rows come from the source file read a second time, never from the report, which holds
// positions and reasons and no value. So this text is values from the file and goes only to the
// member who asked for it: it is not stored, logged or put in an error.

type Delimiter = NonNullable<DelimitedTextOptions["delimiter"]>;

export interface RejectedRowReason {
  readonly rowNumber: number;
  readonly reason: string;
}

// The name of the added column. A file that already has a column of that name gets the next free
// one, so the header never names two columns alike and the file reads back.
const REASON_COLUMN = "Not Brought In Because";

export function reasonColumnNameFor(columns: readonly string[]): string {
  let name = REASON_COLUMN;
  for (let attempt = 2; columns.includes(name); attempt += 1) {
    name = `${REASON_COLUMN} ${String(attempt)}`;
  }
  return name;
}

function written(value: string, delimiter: Delimiter): string {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim();
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

function line(values: readonly string[], delimiter: Delimiter): string {
  return `${values.map((value) => written(value, delimiter)).join(delimiter)}\r\n`;
}

// One piece of text per line, so the caller can send each as it is made and hold one row at a time.
// A row is written with the values it arrived with, a ragged row included: a short row stays short.
export async function* rejectedRowsAsDelimitedText(
  events: AsyncIterable<DelimitedTextEvent>,
  rejected: readonly RejectedRowReason[],
  delimiter: Delimiter = ",",
): AsyncGenerator<string> {
  const reasons = new Map<number, string>();
  for (const row of rejected) reasons.set(row.rowNumber, row.reason);
  let remaining = reasons.size;
  for await (const event of events) {
    if (event.kind === "header") {
      yield line([reasonColumnNameFor(event.columns), ...event.columns], delimiter);
      if (remaining === 0) return;
      continue;
    }
    const reason = reasons.get(event.row.rowNumber);
    if (reason === undefined) continue;
    yield line([reason, ...event.row.values], delimiter);
    remaining -= 1;
    // Every rejected row has been written; the rest of the file need not be read.
    if (remaining === 0) return;
  }
}
