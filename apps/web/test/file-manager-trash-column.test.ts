import { describe, expect, it } from "vitest";
import { deletedColumns, leavesTrashAt } from "../src/lib/file-manager/file-columns.ts";
import { MatterFileIndex } from "../src/lib/file-manager/file-rows.ts";
import type { DeletedFileSummary } from "../src/lib/file-manager/matter-file-api.ts";

const row: DeletedFileSummary = {
  id: "file_1",
  name: "Draft Answer.docx",
  folderId: null,
  documentTypeId: null,
  deletedAt: "2026-11-01T12:00:00.000Z",
  deletedBy: null,
  deletedByName: null,
  currentVersionId: "version_1",
  sizeBytes: 10,
  sniffedContentType: null,
};

function leavesTrashColumn(
  trashPolicy: { trashDays: number; afterTrash: "archive" | "keep-standard" } | null,
  nowIso: string,
) {
  const column = deletedColumns({
    index: new MatterFileIndex([], []),
    hideExtensions: false,
    documentTypeName: () => "",
    trashPolicy,
    now: () => Date.parse(nowIso),
  }).find((candidate) => candidate.id === "leavesTrash");
  if (column === undefined) throw new Error("no Leaves Trash column");
  return column;
}

describe("the Leaves Trash column", () => {
  it("adds the firm's window to the deletion", () => {
    expect(leavesTrashAt(row.deletedAt, 30)).toBe("2026-12-01T12:00:00.000Z");
  });

  it("says nothing until the policy is read", () => {
    expect(leavesTrashColumn(null, "2026-11-05T00:00:00Z").text?.(row)).toBe("");
  });

  it("names the day while the file is still in Trash", () => {
    const text = leavesTrashColumn(
      { trashDays: 30, afterTrash: "archive" },
      "2026-11-05T00:00:00Z",
    ).text?.(row);
    expect(text).not.toBe("");
    expect(text).not.toBe("Archived");
  });

  it("says where the file went once the window has passed", () => {
    expect(
      leavesTrashColumn({ trashDays: 30, afterTrash: "archive" }, "2026-12-05T00:00:00Z").text?.(
        row,
      ),
    ).toBe("Archived");
    expect(
      leavesTrashColumn(
        { trashDays: 30, afterTrash: "keep-standard" },
        "2026-12-05T00:00:00Z",
      ).text?.(row),
    ).toBe("Out of Trash");
  });
});
