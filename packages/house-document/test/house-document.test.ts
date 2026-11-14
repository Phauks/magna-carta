import { describe, expect, it } from "vitest";

import {
  card,
  clock,
  composeReadable,
  contentSize,
  coverSheet,
  figures,
  groupedCode,
  houseDocument,
  housePictures,
  instantFields,
  noteLine,
  pagedTable,
  pageHeading,
  pageList,
  pictureWidth,
  signatureLines,
  styledTable,
  tablePages,
} from "../src/index.ts";

const COLUMNS = [
  { heading: "When", weight: 20 },
  { heading: "What", weight: 80 },
];

describe("houseDocument", () => {
  it("supplies the margins, accent, typeface, letterhead and page number", () => {
    const document = houseDocument({
      name: "Exhibit List",
      reference: { label: "Matter", value: "2026-0042" },
      created: "2026-07-18T12:00:01Z",
      blocks: [{ type: "paragraph", text: "Body" }],
    });
    expect(document).toEqual({
      title: "Exhibit List",
      language: "en-US",
      created: { year: 2026, month: 7, day: 18, hour: 12, minute: 0, second: 1 },
      // Half an inch from every edge of the paper: the sides, the letterhead's bar (which takes
      // 60 points above the content) and the page number (28 below it).
      page: { paper: "letter", marginTop: 96, marginRight: 36, marginBottom: 64, marginLeft: 36 },
      accent: [98, 72, 0],
      compact: true,
      typeface: "atkinsonHyperlegible",
      letterhead: { image: 0, title: "Exhibit List", label: "Matter", detail: "2026-0042" },
      footer: { center: "Page {page} of {pages}" },
      blocks: [{ type: "paragraph", text: "Body" }],
    });
  });

  it("prints no letterhead for a document that goes out under another heading", () => {
    const document = houseDocument({
      name: "Exhibit List",
      letterhead: false,
      paper: "a4",
      blocks: [],
    });
    expect(document.letterhead).toBeUndefined();
    expect(document.page).toMatchObject({ paper: "a4", marginTop: 36, marginBottom: 64 });
    // The page then has the letterhead's room for content.
    expect(contentSize("a4", false).height - contentSize("a4").height).toBe(60);
  });

  it("turns the paper on its side for a wide table, which holds fewer rows", () => {
    const document = houseDocument({ name: "Aging", landscape: true, blocks: [] });
    expect(document.page).toMatchObject({ paper: "letter", landscape: true });
    expect(contentSize("letter", true, true)).toEqual({ width: 720, height: 452 });
    const rows = Array.from({ length: 60 }, () => ["2026-07-18", "Short"]);
    expect(tablePages(COLUMNS, rows, { landscape: true })[0]).toHaveLength(24);
  });

  it("leaves out a made-on time that does not read as an instant", () => {
    expect(
      houseDocument({ name: "Note", created: "sometime", blocks: [] }).created,
    ).toBeUndefined();
  });

  it("puts the lockup first among the pictures, where the letterhead looks for it", () => {
    const own = new Uint8Array([1, 2, 3]);
    const pictures = housePictures([own]);
    expect(Array.from(pictures[0] ?? []).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(pictures[1]).toBe(own);
  });
});

describe("the builders", () => {
  it("wraps a section's blocks in a card, titled or not", () => {
    expect(card("Details", { type: "paragraph", text: "One" })).toEqual([
      { type: "cardStart", title: "Details" },
      { type: "paragraph", text: "One" },
      { type: "cardEnd" },
    ]);
    expect(card(undefined)[0]).toEqual({ type: "cardStart" });
  });

  it("numbers a section's pages only when it has more than one", () => {
    expect(pageHeading("Audit Log", 0, 1)).toBe("Audit Log");
    expect(pageHeading("Audit Log", 1, 3)).toBe("Audit Log (2 of 3)");
  });

  it("writes a note from the parts that are present", () => {
    expect(noteLine("Document", ["Firm", undefined, "", "555-0100"])).toEqual({
      type: "paragraph",
      small: true,
      spans: [{ text: "Document: ", bold: true }, { text: "Firm, 555-0100" }],
    });
  });

  it("groups a long code in fours, thirty-two characters to a line", () => {
    const lines = groupedCode("0123456789abcdef".repeat(4)).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("0123 4567 89ab cdef 0123 4567 89ab cdef");
  });

  it("prints an instant in Coordinated Universal Time, and anything else as recorded", () => {
    expect(clock("2026-07-18T08:00:01-04:00")).toBe("2026-07-18 12:00:01");
    expect(instantFields("Signed", "2026-07-18T12:00:01Z")).toEqual([
      { label: "Signed: Date", value: "2026-07-18" },
      { label: "Signed: Time", value: "12:00:01 UTC" },
    ]);
    expect(instantFields("Signed", "last week")).toEqual([{ label: "Signed", value: "last week" }]);
  });

  it("says page numbers as a reader does", () => {
    expect(pageList([3, 1, 2, 7, 2])).toBe("Pages 1-3, 7");
    expect(pageList([4])).toBe("Page 4");
  });

  it("sizes a picture to one height, held to a widest", () => {
    const png = (width: number, height: number) => {
      const bytes = new Uint8Array(24);
      bytes.set([0x89, 0x50, 0x4e, 0x47]);
      new DataView(bytes.buffer).setUint32(16, width);
      new DataView(bytes.buffer).setUint32(20, height);
      return bytes;
    };
    expect(pictureWidth(png(600, 200), 36, 200)).toBe(108);
    expect(pictureWidth(png(4000, 200), 36, 200)).toBe(200);
    // What is not a PNG does not say its size here: half the widest.
    expect(pictureWidth(new Uint8Array([1, 2, 3]), 36, 200)).toBe(100);
  });
});

describe("what a report and a cover sheet are made of", () => {
  it("marks a table's totals, parts and withdrawn rows by position", () => {
    expect(
      styledTable(COLUMNS, [
        ["May", "Rivera"],
        { cells: ["", "Deposition"], kind: "child" },
        { cells: ["April", "Withdrawn"], kind: "muted" },
        { cells: ["", "Total"], kind: "total" },
      ]),
    ).toEqual({
      type: "table",
      columns: COLUMNS,
      rows: [
        ["May", "Rivera"],
        ["", "Deposition"],
        ["April", "Withdrawn"],
        ["", "Total"],
      ],
      rowStyles: [null, "child", "muted", "total"],
    });
  });

  it("writes a table of plain rows as the plain table", () => {
    expect(styledTable(COLUMNS, [["May", "Rivera"]])).toEqual({
      type: "table",
      columns: COLUMNS,
      rows: [["May", "Rivera"]],
    });
  });

  it("sets summary figures and signature lines as blocks of their own", () => {
    const overdue = {
      label: "Overdue",
      value: "45.00",
      note: "Past 30 days",
      alert: true,
    } as const;
    expect(figures([{ label: "Billed", value: "160.00" }, overdue])).toEqual({
      type: "figures",
      figures: [{ label: "Billed", value: "160.00" }, overdue],
    });
    expect(signatureLines("Signature", "Date")).toEqual({
      type: "signatureLines",
      lines: ["Signature", "Date"],
    });
  });

  it("sets a cover sheet's label a little above the middle of the page", () => {
    const [label, ...lines] = coverSheet("EXHIBIT 4", ["Rivera v. Stone", "No. 26-0042"], {
      letterhead: false,
    });
    const height = contentSize("letter", false).height;
    expect(label).toEqual({ type: "display", text: "EXHIBIT 4", spaceAbove: 258 });
    // The label and its two lines together stand above the middle, never below it.
    const block = 48 + 2 * 15;
    expect(258 + block / 2).toBeLessThan(height / 2);
    expect(258 + block / 2).toBeGreaterThan(height / 3);
    expect(lines).toEqual([
      { type: "paragraph", text: "Rivera v. Stone", alignment: "center" },
      { type: "paragraph", text: "No. 26-0042", alignment: "center" },
    ]);
    // A taller paper sets it further down, and a letterhead leaves less room to set it in.
    const a4 = coverSheet("EXHIBIT 4", [], { paper: "a4", letterhead: false })[0];
    const headed = coverSheet("EXHIBIT 4")[0];
    expect(a4).toMatchObject({ spaceAbove: 291 });
    expect(headed).toMatchObject({ spaceAbove: 245 });
  });
});

describe("paging a long table", () => {
  const rows = (count: number, what = "Short") =>
    Array.from({ length: count }, () => ["2026-07-18 12:00:01", what]);

  it("fills a taller paper further, and a page with no letterhead further still", () => {
    const first = (options: Parameters<typeof tablePages>[2]) =>
      tablePages(COLUMNS, rows(60), options)[0]?.length;
    expect(first({ paper: "letter" })).toBe(35);
    expect(first({ paper: "a4" })).toBe(38);
    expect(first({ paper: "letter", letterhead: false })).toBe(39);
  });

  it("gives rows that wrap the room they take, and leaves fitted columns out of the estimate", () => {
    const long = "A description long enough to wrap. ".repeat(8);
    const wrapped = tablePages(COLUMNS, rows(40, long))[0]?.length ?? 0;
    expect(wrapped).toBeLessThan(20);
    expect(tablePages(COLUMNS, rows(40, long), { fittedColumns: [1] })[0]).toHaveLength(35);
  });

  it("always has a page, so a section with nothing in it still prints its card", () => {
    expect(tablePages(COLUMNS, [])).toEqual([[]]);
    expect(pagedTable("Audit Log", COLUMNS, [])).toEqual([
      { type: "pageBreak" },
      { type: "cardStart", title: "Audit Log" },
      { type: "table", columns: COLUMNS, rows: [] },
      { type: "cardEnd" },
    ]);
  });

  it("starts each page on a new sheet as a card that says its place", () => {
    const blocks = pagedTable("Exhibits", COLUMNS, rows(80));
    expect(blocks.flatMap((block) => (block.type === "cardStart" ? [block.title] : []))).toEqual([
      "Exhibits (1 of 3)",
      "Exhibits (2 of 3)",
      "Exhibits (3 of 3)",
    ]);
    expect(blocks.filter((block) => block.type === "pageBreak")).toHaveLength(3);
  });
});

describe("composeReadable", () => {
  it("composes once when every character was drawn", async () => {
    const asked: (string | undefined)[] = [];
    const result = await composeReadable(async (typeface) => {
      asked.push(typeface);
      return { missingCharacters: [] };
    });
    expect(asked).toEqual([undefined]);
    expect(result.missingCharacters).toEqual([]);
  });

  it("composes again in the wider family when a character was missing", async () => {
    const asked: (string | undefined)[] = [];
    await composeReadable(async (typeface) => {
      asked.push(typeface);
      return { missingCharacters: typeface === undefined ? ["Α"] : [] };
    });
    expect(asked).toEqual([undefined, "liberationSans"]);
  });
});
