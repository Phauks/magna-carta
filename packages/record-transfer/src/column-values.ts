import type { DelimitedTextEvent } from "./delimited-text-reader.ts";
import { valueOf } from "./directory-mapping.ts";
import { sourceFileRowFields } from "./source-file.ts";

// The different values one column of a source file holds, and how many rows hold each. It is what
// lets a screen say "2 of 9 not matched" for a column of codes (the source's names for matter types,
// its initials for staff) before any pass has run.
//
// A value is read the way the mapping rules read a code: trimmed, and an empty one is no value. A
// ragged row is left out here and reported by the pass.
//
// These are values from the file. They are answered to the member who asked and stored nowhere.

// A column of codes has a handful of values. Past this many the column is not a column of codes,
// and the answer says so instead of growing with the file.
export const COLUMN_VALUE_CAP = 500;

// A code is short. A longer value is counted and not answered, so a column of free text or of
// people's details cannot leave through this read.
export const COLUMN_VALUE_LENGTH_CAP = 100;

export interface ColumnValueCount {
  readonly value: string;
  readonly rowCount: number;
}

export interface ColumnValues {
  // False when the file's header has no such column; nothing else is then meaningful.
  readonly columnFound: boolean;
  // The most used first, then by the value itself.
  readonly values: readonly ColumnValueCount[];
  // How many rows hold any value in the column.
  readonly rowsWithValue: number;
  readonly rowsRead: number;
  // True when the column holds more different values than are answered, or a value too long to be
  // a code. The counts above still cover every row.
  readonly truncated: boolean;
}

export async function distinctColumnValues(
  events: AsyncIterable<DelimitedTextEvent>,
  column: string,
): Promise<ColumnValues> {
  let header: readonly string[] | null = null;
  const counts = new Map<string, number>();
  let rowsRead = 0;
  let rowsWithValue = 0;
  let truncated = false;
  for await (const event of events) {
    if (event.kind === "header") {
      header = event.columns;
      if (!header.includes(column)) {
        return { columnFound: false, values: [], rowsWithValue: 0, rowsRead: 0, truncated: false };
      }
      continue;
    }
    if (header === null) continue;
    rowsRead += 1;
    const laid = sourceFileRowFields(header, event.row);
    if (!laid.ok) continue;
    const value = valueOf(laid.fields, column);
    if (value === null) continue;
    rowsWithValue += 1;
    const held = counts.get(value);
    if (held !== undefined) {
      counts.set(value, held + 1);
    } else if (value.length > COLUMN_VALUE_LENGTH_CAP || counts.size >= COLUMN_VALUE_CAP) {
      truncated = true;
    } else {
      counts.set(value, 1);
    }
  }
  const values = [...counts.entries()]
    .map(([value, rowCount]) => ({ value, rowCount }))
    .toSorted(
      (left, right) => right.rowCount - left.rowCount || left.value.localeCompare(right.value),
    );
  return { columnFound: header !== null, values, rowsWithValue, rowsRead, truncated };
}
