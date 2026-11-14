import { describe, expect, it } from "vitest";
import {
  DelimitedTextError,
  readDelimitedText,
  type DelimitedTextEvent,
  type DelimitedTextOptions,
} from "../src/delimited-text-reader.ts";
import {
  UnknownKeyColumnError,
  sourceFileRowFields,
  sourceIdOfRow,
  type SourceFileRow,
} from "../src/source-file.ts";

interface Read {
  readonly header: readonly string[];
  readonly rows: readonly SourceFileRow[];
}

async function read(chunks: readonly string[], options?: DelimitedTextOptions): Promise<Read> {
  let header: readonly string[] = [];
  const rows: SourceFileRow[] = [];
  const events: DelimitedTextEvent[] = [];
  for await (const event of readDelimitedText(chunks, options)) events.push(event);
  for (const event of events) {
    if (event.kind === "header") header = event.columns;
    else rows.push(event.row);
  }
  return { header, rows };
}

async function faultOf(chunks: readonly string[]): Promise<DelimitedTextError> {
  try {
    await read(chunks);
  } catch (caught) {
    if (caught instanceof DelimitedTextError) return caught;
    throw caught;
  }
  throw new Error("expected the file to be refused");
}

describe("reading delimited text", () => {
  it("reads a header and numbered rows", async () => {
    const { header, rows } = await read(["Number,Client\n1001,Ada\n1002,Grace\n"]);
    expect(header).toEqual(["Number", "Client"]);
    expect(rows).toEqual([
      { rowNumber: 1, lineNumber: 2, values: ["1001", "Ada"] },
      { rowNumber: 2, lineNumber: 3, values: ["1002", "Grace"] },
    ]);
  });

  it("reads the last row whether or not the file ends with a line ending", async () => {
    expect((await read(["a,b\n1,2"])).rows).toHaveLength(1);
    expect((await read(["a,b\n1,2\n"])).rows).toHaveLength(1);
    expect((await read(["a,b\r\n1,2\r\n"])).rows).toHaveLength(1);
  });

  it("accepts all three line endings and counts each as one line", async () => {
    const { rows } = await read(["a\r\n1\r2\n3"]);
    expect(rows.map((row) => [row.values[0], row.lineNumber])).toEqual([
      ["1", 2],
      ["2", 3],
      ["3", 4],
    ]);
  });

  it("keeps a delimiter, a line break and a doubled quote inside a quoted value", async () => {
    const { rows } = await read([
      'name,note\n"Lovelace, Ada","She said ""yes""\nthen left"\nB,c\n',
    ]);
    expect(rows[0]?.values).toEqual(["Lovelace, Ada", 'She said "yes"\nthen left']);
    // The second row starts two lines after the first, because the first held a line break.
    expect(rows[0]?.lineNumber).toBe(2);
    expect(rows[1]).toEqual({ rowNumber: 2, lineNumber: 4, values: ["B", "c"] });
  });

  it("gives the same rows however the text is cut into pieces", async () => {
    const text = 'a,b\r\n"x ""q"", y",2\r\n\r\n3,"multi\r\nline"\r\n';
    const whole = await read([text]);
    for (let size = 1; size <= 7; size += 1) {
      const pieces: string[] = [];
      for (let start = 0; start < text.length; start += size) {
        pieces.push(text.slice(start, start + size));
      }
      expect(await read(pieces), `pieces of ${size}`).toEqual(whole);
    }
    expect(whole.rows.map((row) => row.values)).toEqual([
      ['x "q", y', "2"],
      ["3", "multi\r\nline"],
    ]);
  });

  it("changes no value: nothing is trimmed and nothing is read as a number", async () => {
    const { rows } = await read(["a,b,c\n  padded  ,007,NULL\n"]);
    expect(rows[0]?.values).toEqual(["  padded  ", "007", "NULL"]);
  });

  it("treats a quote inside an unquoted value as the character it is", async () => {
    const { rows } = await read(['size\n5" pipe\n']);
    expect(rows[0]?.values).toEqual(['5" pipe']);
  });

  it("skips a line with nothing on it and keeps a line of empty values", async () => {
    const { rows } = await read(['a,b\n\n1,2\n,\n""\n\n']);
    expect(rows.map((row) => row.values)).toEqual([["1", "2"], ["", ""], [""]]);
    expect(rows.map((row) => row.rowNumber)).toEqual([1, 2, 3]);
  });

  it("drops a byte order mark from the first column's name", async () => {
    expect((await read(["﻿Number,Client\n1,2\n"])).header).toEqual(["Number", "Client"]);
  });

  it("reads another delimiter when told to", async () => {
    const { header, rows } = await read(["a\tb\n1,5\t2\n"], { delimiter: "\t" });
    expect(header).toEqual(["a", "b"]);
    expect(rows[0]?.values).toEqual(["1,5", "2"]);
  });

  it("reads a ragged row as it is and leaves judging it to the caller", async () => {
    const { header, rows } = await read(["a,b\n1\n1,2,3\n1,2\n"]);
    const outcomes = rows.map((row) => sourceFileRowFields(header, row));
    expect(outcomes[0]).toEqual({ ok: false, fault: "tooFewValues" });
    expect(outcomes[1]).toEqual({ ok: false, fault: "tooManyValues" });
    expect(outcomes[2]?.ok).toBe(true);
    if (outcomes[2]?.ok === true) {
      expect([...outcomes[2].fields]).toEqual([
        ["a", "1"],
        ["b", "2"],
      ]);
    }
  });

  it("reads a file that is a header and nothing else as no rows", async () => {
    expect(await read(["a,b\n"])).toEqual({ header: ["a", "b"], rows: [] });
  });
});

describe("a file that cannot be read as rows is refused, with a reason and a line", () => {
  it("refuses an empty file and a file of blank lines", async () => {
    expect((await faultOf([])).fault).toBe("noHeader");
    expect((await faultOf(["\n\n"])).fault).toBe("noHeader");
  });

  it("refuses a header with a blank name or the same name twice", async () => {
    expect((await faultOf(["a,,c\n1,2,3\n"])).fault).toBe("blankColumnName");
    expect((await faultOf(["a,b,a\n1,2,3\n"])).fault).toBe("duplicateColumnName");
  });

  it("refuses a file that ends inside a quoted value, naming the line the value began on", async () => {
    const fault = await faultOf(['a,b\n1,2\n3,"cut off\nmid value']);
    expect(fault.fault).toBe("unterminatedQuote");
    expect(fault.lineNumber).toBe(3);
  });

  it("accepts a closing quote as the last character of the file", async () => {
    expect((await read(['a\n"x"'])).rows[0]?.values).toEqual(["x"]);
  });

  it("says nothing from the file in its message", async () => {
    const fault = await faultOf(["Client Name,Client Name\n"]);
    expect(fault.message).not.toContain("Client Name");
  });
});

describe("a row's key is the value under the key column, verbatim", () => {
  const header = ["Number", "Client"];
  const row: SourceFileRow = { rowNumber: 1, lineNumber: 2, values: [" 0042 ", "Ada"] };

  it("returns the value unchanged", () => {
    expect(sourceIdOfRow(header, "Number", row)).toBe(" 0042 ");
  });

  it("returns null for an empty or missing value", () => {
    expect(sourceIdOfRow(header, "Number", { ...row, values: ["", "Ada"] })).toBeNull();
    expect(sourceIdOfRow(header, "Client", { ...row, values: ["7"] })).toBeNull();
  });

  it("refuses a key column the file does not have", () => {
    expect(() => sourceIdOfRow(header, "number", row)).toThrow(UnknownKeyColumnError);
  });
});
