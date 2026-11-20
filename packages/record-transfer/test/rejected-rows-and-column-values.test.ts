import { describe, expect, it } from "vitest";
import { COLUMN_VALUE_CAP, distinctColumnValues } from "../src/column-values.ts";
import { readDelimitedText } from "../src/delimited-text-reader.ts";
import { reasonColumnNameFor, rejectedRowsAsDelimitedText } from "../src/rejected-rows.ts";

async function text(lines: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const line of lines) out += line;
  return out;
}

describe("rejected rows given back as a file", () => {
  const FILE = [
    "Id,Name,Note",
    "a-1,Ada,plain",
    'a-2,,"said ""no"", twice"',
    "a-3,Grace,",
    'a-4,,"two\nlines"',
    "",
  ].join("\n");

  it("writes the header with a reason column in front, then only the rejected rows as they arrived", async () => {
    const out = await text(
      rejectedRowsAsDelimitedText(readDelimitedText([FILE]), [
        { rowNumber: 2, reason: "noName" },
        { rowNumber: 4, reason: "noName" },
      ]),
    );
    expect(out).toBe(
      [
        "Not Brought In Because,Id,Name,Note",
        'noName,a-2,,"said ""no"", twice"',
        'noName,a-4,,"two\nlines"',
        "",
      ].join("\r\n"),
    );
  });

  it("reads back as rows with the same values", async () => {
    const out = await text(
      rejectedRowsAsDelimitedText(readDelimitedText([FILE]), [{ rowNumber: 2, reason: "noName" }]),
    );
    const rows: string[][] = [];
    for await (const event of readDelimitedText([out])) {
      if (event.kind === "row") rows.push([...event.row.values]);
    }
    expect(rows).toEqual([["noName", "a-2", "", 'said "no", twice']]);
  });

  it("keeps the file's own delimiter, and writes a header alone when nothing was rejected", async () => {
    const tabbed = "Id\tName\na;1\tAda\n";
    expect(
      await text(
        rejectedRowsAsDelimitedText(
          readDelimitedText([tabbed], { delimiter: "\t" }),
          [{ rowNumber: 1, reason: "emptyKey" }],
          "\t",
        ),
      ),
    ).toBe("Not Brought In Because\tId\tName\r\nemptyKey\ta;1\tAda\r\n");
    expect(await text(rejectedRowsAsDelimitedText(readDelimitedText([FILE]), []))).toBe(
      "Not Brought In Because,Id,Name,Note\r\n",
    );
  });

  it("names its column apart from a column the file already has", () => {
    expect(reasonColumnNameFor(["Id", "Not Brought In Because"])).toBe("Not Brought In Because 2");
  });
});

describe("the different values of a column", () => {
  it("counts trimmed values, the most used first, and leaves out empty values and ragged rows", async () => {
    const file = "Id,Type\n1,Family\n2, Family \n3,Wills\n4,\n5\n6,Family\n";
    expect(await distinctColumnValues(readDelimitedText([file]), "Type")).toEqual({
      columnFound: true,
      values: [
        { value: "Family", rowCount: 3 },
        { value: "Wills", rowCount: 1 },
      ],
      rowsWithValue: 4,
      rowsRead: 6,
      truncated: false,
    });
  });

  it("says when the file has no such column", async () => {
    const found = await distinctColumnValues(readDelimitedText(["Id,Type\n1,x\n"]), "Kind");
    expect(found.columnFound).toBe(false);
  });

  it("stops answering new values past the cap and leaves out a value too long to be a code", async () => {
    const many = [
      "Id,Code",
      ...Array.from({ length: COLUMN_VALUE_CAP + 5 }, (_, n) => `${n},c${n}`),
    ];
    const capped = await distinctColumnValues(readDelimitedText([many.join("\n")]), "Code");
    expect(capped.values).toHaveLength(COLUMN_VALUE_CAP);
    expect(capped.truncated).toBe(true);
    expect(capped.rowsWithValue).toBe(COLUMN_VALUE_CAP + 5);

    const long = await distinctColumnValues(
      readDelimitedText([`Id,Code\n1,${"x".repeat(101)}\n2,ok\n`]),
      "Code",
    );
    expect(long.values).toEqual([{ value: "ok", rowCount: 1 }]);
    expect(long.truncated).toBe(true);
  });
});
