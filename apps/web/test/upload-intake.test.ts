import { describe, expect, it } from "vitest";
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import type { GridColumn, GridSortDirection } from "@magna-carta/design-system/data-table";
import {
  addIntakeEntries,
  intakeColumns,
  intakeFolderKey,
  intakeFolderPaths,
  intakeFileKey,
  intakeEntryKey,
  intakeKeysOfRows,
  intakePhrase,
  intakeRows,
  orderIntakeRows,
  removeIntakeRows,
  type IntakeProgress,
  type IntakeRow,
} from "$lib/file-manager/upload-intake.ts";

/*
 * The intake is what the reader checks before pressing Upload and watches while it runs, so what
 * it shows has to be right in ways a glance at a browser does not settle: one file offered twice is
 * one file, a folder's row sums what is under it, a sort inside the tree keeps children under
 * their parent, and a filter turns the tree into the flat list that answers it.
 */

function entry(
  relativePath: string,
  name: string,
  size = 100,
  lastModified = 1_700_000_000_000,
): DroppedEntry {
  return { file: new File(["x".repeat(size)], name, { lastModified }), relativePath };
}

/*
 * The grid's own comparator lives behind the design system's data-table entry, which loads Svelte
 * components this node-only suite cannot. Its rule is small enough to restate: the column's value,
 * empties last, the row key as the tiebreak. The grid pins the real one in its own suite.
 */
function comparator(
  column: GridColumn<IntakeRow>,
  direction: GridSortDirection,
): (left: IntakeRow, right: IntakeRow) => number {
  const sign = direction === "descending" ? -1 : 1;
  return (left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    if (a == null || a === "") return b == null || b === "" ? 0 : 1;
    if (b == null || b === "") return -1;
    const comparison =
      typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return comparison === 0 ? left.key.localeCompare(right.key) : comparison * sign;
  };
}

const LETTER = entry("Discovery/2024/letter.pdf", "letter.pdf", 300);
const MEMO = entry("Discovery/memo.docx", "memo.docx", 200, 1_600_000_000_000);
const NOTES = entry("", "notes.txt", 50);
const INVOICE = entry("Billing/invoice.pdf", "invoice.pdf", 400, 1_800_000_000_000);
const ALL = [LETTER, MEMO, NOTES, INVOICE];
const NO_PROGRESS: ReadonlyMap<string, IntakeProgress> = new Map();

describe("adding and removing", () => {
  it("does not double a file offered twice, and keeps the order things arrived in", () => {
    const once = addIntakeEntries([], [LETTER, MEMO]);
    const twice = addIntakeEntries(once, [MEMO, NOTES]);
    expect(twice.map((item) => item.file.name)).toEqual(["letter.pdf", "memo.docx", "notes.txt"]);
  });

  it("removing a folder removes everything beneath it, and nothing beside it", () => {
    const left = removeIntakeRows(ALL, [intakeFolderKey("Discovery")]);
    expect(left.map((item) => item.file.name)).toEqual(["notes.txt", "invoice.pdf"]);
  });

  it("removing a file removes only that file", () => {
    const left = removeIntakeRows(ALL, [intakeFileKey(MEMO)]);
    expect(left).toHaveLength(3);
    expect(left).not.toContain(MEMO);
  });
});

describe("the tree", () => {
  it("shows every folder as a row, its files beneath it when expanded, at their depth", () => {
    const rows = intakeRows(ALL, NO_PROGRESS, new Set(["Discovery", "Discovery/2024"]));
    expect(
      rows.map(
        (row) => `${"  ".repeat(row.depth)}${row.kind === "folder" ? row.name + "/" : row.name}`,
      ),
    ).toEqual(["Discovery/", "  2024/", "    letter.pdf", "  memo.docx", "Billing/", "notes.txt"]);
  });

  it("keeps a collapsed folder's contents out of the rows", () => {
    const rows = intakeRows(ALL, NO_PROGRESS, new Set());
    expect(rows.map((row) => row.name)).toEqual(["Discovery", "Billing", "notes.txt"]);
  });

  it("a folder row sums what is under it and carries the most recent device date", () => {
    const rows = intakeRows(ALL, NO_PROGRESS, new Set());
    const discovery = rows.find((row) => row.kind === "folder" && row.name === "Discovery");
    expect(discovery).toMatchObject({
      fileCount: 2,
      totalBytes: 500,
      latestModified: 1_700_000_000_000,
    });
  });

  it("a folder row reports how its files are doing once the transfer runs", () => {
    const progress = new Map<string, IntakeProgress>([
      [`${LETTER.relativePath} | letter.pdf | 300 | 1700000000000`, { stage: "settled" }],
      [`${MEMO.relativePath} | memo.docx | 200 | 1600000000000`, { stage: "failed", reason: "no" }],
    ]);
    const rows = intakeRows(ALL, progress, new Set());
    const discovery = rows.find((row) => row.kind === "folder" && row.name === "Discovery");
    expect(discovery).toMatchObject({ uploaded: 1, failed: 1, inFlight: 0 });
    const status = intakeColumns({ filtering: false, documentTypes: false }).find(
      (column) => column.id === "status",
    );
    expect(status?.value(discovery as IntakeRow)).toBe("1 of 2 uploaded · 1 failed");
  });

  it("a folder row reports how many of its files are ready before the transfer runs", () => {
    const status = intakeColumns({ filtering: false, documentTypes: false }).find(
      (column) => column.id === "status",
    );
    const letterKey = `${LETTER.relativePath} | letter.pdf | 300 | 1700000000000`;
    const memoKey = `${MEMO.relativePath} | memo.docx | 200 | 1600000000000`;
    const discoveryOf = (progress: ReadonlyMap<string, IntakeProgress>) =>
      intakeRows(ALL, progress, new Set()).find(
        (row) => row.kind === "folder" && row.name === "Discovery",
      );

    // Nothing read yet: chosen, and that is all.
    expect(status?.value(discoveryOf(NO_PROGRESS) as IntakeRow)).toBe("Chosen");

    // One file still being read, the other ready: readiness, not a tally of uploads.
    const reading = new Map<string, IntakeProgress>([
      [letterKey, { stage: "hashing", hashedBytes: 100 }],
      [memoKey, { stage: "ready" }],
    ]);
    expect(discoveryOf(reading)).toMatchObject({ ready: 1, reading: 1, inFlight: 0 });
    expect(status?.value(discoveryOf(reading) as IntakeRow)).toBe("1 of 2 ready");

    // A held file is ready — the answer is that nothing needs sending — and is named as held.
    const held = new Map<string, IntakeProgress>([
      [letterKey, { stage: "held" }],
      [memoKey, { stage: "unread" }],
    ]);
    expect(status?.value(discoveryOf(held) as IntakeRow)).toBe(
      "1 of 2 ready · 1 held · 1 not read",
    );
  });

  it("a file row carries what failed as its own line, apart from the whole account", () => {
    const progress = new Map<string, IntakeProgress>([
      [
        `${LETTER.relativePath} | letter.pdf | 300 | 1700000000000`,
        {
          stage: "failed",
          reason: "Refused (failed while reserving; Error ID E-1)",
          failure: "Refused",
        },
      ],
    ]);
    const letter = intakeRows(ALL, progress, null).find((row) => row.name === "letter.pdf");
    expect(letter).toMatchObject({ stage: "failed", failure: "Refused" });
  });

  it("flattens to files alone when asked, which is what a filter wants", () => {
    const rows = intakeRows(ALL, NO_PROGRESS, null);
    expect(rows.every((row) => row.kind === "file" && row.depth === 0)).toBe(true);
    const folder = intakeColumns({ filtering: true, documentTypes: false }).find(
      (column) => column.id === "folder",
    );
    expect(rows.map((row) => folder?.value(row))).toEqual([
      "Discovery / 2024",
      "Discovery",
      "Home",
      "Billing",
    ]);
  });

  it("names every folder path so the tree can open fully on arrival", () => {
    expect(intakeFolderPaths(ALL).toSorted()).toEqual(["Billing", "Discovery", "Discovery/2024"]);
  });
});

describe("ordering inside the tree", () => {
  const nameColumn = intakeColumns({ filtering: false, documentTypes: false }).find(
    (column) => column.id === "name",
  ) as GridColumn<IntakeRow>;
  const sizeColumn = intakeColumns({ filtering: false, documentTypes: false }).find(
    (column) => column.id === "size",
  ) as GridColumn<IntakeRow>;
  it("sorts siblings by the grid's comparator and keeps every child under its parent", () => {
    const rows = intakeRows(ALL, NO_PROGRESS, new Set(["Discovery", "Discovery/2024"]));
    const descending = orderIntakeRows(rows, comparator(nameColumn, "descending"));
    expect(descending.map((row) => row.name)).toEqual([
      // Folders first at the root, sorted Z to A; then the root's files.
      "Discovery",
      "2024",
      "letter.pdf",
      "memo.docx",
      "Billing",
      "notes.txt",
    ]);
  });

  it("sorting by a number column still holds the hierarchy", () => {
    const rows = intakeRows(ALL, NO_PROGRESS, new Set(["Discovery", "Discovery/2024", "Billing"]));
    const bySize = orderIntakeRows(rows, comparator(sizeColumn, "ascending"));
    // Billing (400) is smaller than Discovery (500), so it leads; letter.pdf stays under 2024.
    expect(bySize.map((row) => row.name)).toEqual([
      "Billing",
      "invoice.pdf",
      "Discovery",
      "2024",
      "letter.pdf",
      "memo.docx",
      "notes.txt",
    ]);
  });

  it("seats a row whose parent is absent under the nearest ancestor that is present", () => {
    const rows = intakeRows(
      ALL,
      NO_PROGRESS,
      new Set(["Discovery", "Discovery/2024", "Billing"]),
    ).filter((row) => !(row.kind === "folder" && row.path === "Discovery/2024"));
    const ordered = orderIntakeRows(rows, comparator(nameColumn, "ascending"));
    expect(ordered.map((row) => row.name)).toEqual([
      "Billing",
      "invoice.pdf",
      "Discovery",
      "letter.pdf",
      "memo.docx",
      "notes.txt",
    ]);
  });
});

describe("the phrase", () => {
  it("counts files alone, or folders with the files inside them", () => {
    expect(intakePhrase([NOTES])).toBe("1 file");
    expect(intakePhrase(ALL)).toBe("2 folders, 4 files inside");
  });
});

/*
 * A document type belongs to a FILE, not to a batch: one folder of discovery holds correspondence,
 * pleadings and exhibits together, so the classification is a column the reader sets on the rows
 * they have selected. Selecting a FOLDER row means every file beneath it, however deep, which is
 * the rule Remove Selected already follows.
 */
describe("the document type, per file", () => {
  it("resolves a selection of folder and file rows to the files it stands for", () => {
    const keys = intakeKeysOfRows(ALL, [intakeFolderKey("Discovery"), intakeFileKey(INVOICE)]);
    expect(keys).toEqual([intakeEntryKey(LETTER), intakeEntryKey(MEMO), intakeEntryKey(INVOICE)]);
  });

  it("shows each file's own type, and says None where a file carries none", () => {
    const named = new Map([[intakeEntryKey(LETTER), "Correspondence"]]);
    const rows = intakeRows(ALL, NO_PROGRESS, null, (key) => named.get(key) ?? "");
    const column = intakeColumns({ filtering: true, documentTypes: true }).find(
      (candidate) => candidate.id === "documentType",
    ) as GridColumn<IntakeRow>;
    expect(column).toBeDefined();
    const letter = rows.find((row) => row.name === "letter.pdf") as IntakeRow;
    const memo = rows.find((row) => row.name === "memo.docx") as IntakeRow;
    expect(column.value(letter)).toBe("Correspondence");
    // "None" is the value rather than a text override, so it is a choice in the column's filter.
    expect(column.value(memo)).toBe("None");
  });

  it("is left out of the model entirely where the firm defines no classifications", () => {
    // Out of the model rather than declared hidden: the hidden flag is read once, when the grid is
    // built, so a column declared hidden before the types loaded could never come back.
    const column = intakeColumns({ filtering: false, documentTypes: false }).find(
      (candidate) => candidate.id === "documentType",
    );
    expect(column).toBeUndefined();
  });
});
