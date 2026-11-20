import { describe, expect, it } from "vitest";
import { exhibitCoverDocument, exhibitListDocument } from "../src/list-document.ts";

describe("the printed exhibit list", () => {
  const base = {
    matterTitle: "Harrington v. Coastline Marine",
    caseNumber: "24-CV-0193",
    setName: "Plaintiff's Trial Exhibits",
    noun: "Exhibit",
    preparedOn: "November 19, 2026",
  };

  it("prints numbered labels as written, greys a withdrawn exhibit, and carries Bates ranges", () => {
    const document = exhibitListDocument({
      ...base,
      entries: [
        { label: "1", title: "Lease", withdrawn: false, pageCount: 8, bates: "H000003 to H000010" },
        { label: "2", title: "Survey", withdrawn: true, pageCount: 2, bates: null },
      ],
    });
    expect(document.letterhead).toBeUndefined();
    const table = document.blocks.find((block) => block.type === "table");
    expect(table).toEqual({
      type: "table",
      columns: [
        { heading: "Exhibit", weight: 14 },
        { heading: "Description", weight: 50 },
        { heading: "Bates", weight: 26 },
        { heading: "Pages", weight: 10, alignment: "end" },
      ],
      rows: [
        ["1", "Lease", "H000003 to H000010", "8"],
        ["2", "Survey (withdrawn)", "", "2"],
      ],
      rowStyles: [null, "muted"],
    });
    expect(document.blocks[1]).toEqual({
      type: "paragraph",
      text: "Case No. 24-CV-0193",
      alignment: "center",
    });
  });

  it("leaves the Bates column out when no exhibit has a range, and the case number when absent", () => {
    const document = exhibitListDocument({
      ...base,
      caseNumber: null,
      entries: [{ label: "A", title: "Lease", withdrawn: false, pageCount: null, bates: null }],
    });
    const table = document.blocks.find((block) => block.type === "table");
    expect(table?.type === "table" ? table.columns.map((column) => column.heading) : []).toEqual([
      "Exhibit",
      "Description",
      "Pages",
    ]);
    expect(document.blocks.filter((block) => block.type === "paragraph")).toHaveLength(2);
  });

  it("sets a cover sheet's caption large, numbered or lettered", () => {
    const cover = exhibitCoverDocument("Exhibit 12", "Email chain re: vessel inspection");
    expect(cover.blocks[0]).toMatchObject({ type: "display", text: "EXHIBIT 12" });
    expect(cover.blocks[1]).toEqual({
      type: "paragraph",
      text: "Email chain re: vessel inspection",
      alignment: "center",
    });
  });
});
