import { describe, expect, it } from "vitest";
import type { Finding, MetadataReport } from "@magna-carta/metadata";
import {
  cleanCopyName,
  groupsOf,
  leftBehind,
  optionsFrom,
  valueCell,
} from "../src/lib/tools/file-workbench/metadata-reading.ts";

function finding(category: Finding["category"], count = 1): Finding {
  return { category, label: category, risk: "high", count, defaultScrub: true };
}

function report(findings: Finding[]): MetadataReport {
  return { format: "docx", findings, clean: findings.length === 0 };
}

describe("groupsOf", () => {
  it("puts each finding under the one switch that strips it, in drawing order", () => {
    const groups = groupsOf(
      report([
        finding("custom-properties"),
        finding("edit-history", 14),
        finding("comments", 2),
        finding("identifying-metadata"),
      ]),
    );
    expect(groups.map((group) => group.switch)).toEqual([
      "comments",
      "identifyingMetadata",
      "customProperties",
    ]);
    expect(groups[1]!.findings.map((each) => each.category)).toEqual([
      "edit-history",
      "identifying-metadata",
    ]);
  });

  it("draws nothing for a clean file", () => {
    expect(groupsOf(report([]))).toEqual([]);
  });

  it("covers every category the engine can report", () => {
    const categories: Finding["category"][] = [
      "identifying-metadata",
      "tracked-changes",
      "comments",
      "hidden-content",
      "custom-properties",
      "edit-history",
      "document-settings",
      "embedded-preview",
      "embedded-data",
      "image-location",
      "image-software",
      "image-other",
      "image-trailing-data",
    ];
    const drawn = groupsOf(report(categories.map((category) => finding(category)))).flatMap(
      (group) => group.findings,
    );
    expect(drawn).toHaveLength(categories.length);
  });
});

describe("optionsFrom", () => {
  it("turns on only the ticked switches", () => {
    expect(optionsFrom(new Set(["comments", "imageMetadata"]))).toEqual({
      identifyingMetadata: false,
      trackedChanges: false,
      comments: true,
      hiddenContent: false,
      customProperties: false,
      imageMetadata: true,
    });
  });
});

describe("leftBehind", () => {
  it("names only what was ticked and is still there", () => {
    const output = report([finding("comments"), finding("custom-properties")]);
    expect(leftBehind(output, new Set(["comments"])).map((each) => each.category)).toEqual([
      "comments",
    ]);
    expect(leftBehind(output, new Set(["trackedChanges"]))).toEqual([]);
  });
});

describe("the values in each table", () => {
  it("lists a tracked change by author, change and moment", () => {
    const changes: Finding = {
      ...finding("tracked-changes", 3),
      fields: [
        {
          name: "J. Alvarez",
          value: { form: "text", text: "$250 per hour" },
          revision: "deleted",
          when: { form: "instant", instant: "2026-10-02T14:31:00.000Z" },
        },
        { name: "", value: { form: "text", text: "" }, revision: "formatted" },
      ],
    };
    const [group] = groupsOf(report([changes]));
    expect(group!.columns).toEqual(["Author", "Change", "When"]);
    const [first, second] = group!.rows;
    expect(first!.cells[0]!.text).toBe("J. Alvarez");
    expect(first!.cells[1]!.text).toBe('Deleted "$250 per hour"');
    expect(first!.cells[2]!.datetime).toBe("2026-10-02T14:31:00.000Z");
    expect(first!.cells[2]!.text).toContain("2026");
    expect(second!.cells.map((cell) => cell.text)).toEqual([
      "Not recorded",
      "Changed formatting",
      "Not recorded",
    ]);
    expect(second!.cells[0]!.muted).toBe(true);
  });

  it("lists properties by name and value, with a count row for a finding with no values", () => {
    const properties: Finding = {
      ...finding("identifying-metadata"),
      fields: [
        { name: "Author", value: { form: "text", text: "Jordan Alvarez" } },
        { name: "Total Editing Time", value: { form: "minutes", minutes: 252 } },
      ],
    };
    const [group] = groupsOf(report([finding("edit-history", 14), properties]));
    expect(group!.title).toBe("Document Properties");
    expect(group!.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["Author", "Jordan Alvarez"],
      ["Total Editing Time", "4.20 (4:12)"],
      ["Editing marks", "14"],
    ]);
  });

  it("shows a camera clock as written, and says it names no zone", () => {
    const cell = valueCell({ form: "zoneless", date: "2026-10-02", time: "14:31" });
    expect(cell.text).toContain("2026");
    expect(cell.text).toMatch(/2:31|14:31/);
    expect(cell.note).toBe("No time zone recorded");
    expect(cell.datetime).toBeUndefined();
  });

  it("says where hidden text sits", () => {
    const hidden: Finding = {
      ...finding("hidden-content"),
      fields: [{ name: "", value: { form: "text", text: "Do not send." }, part: "footnotes" }],
    };
    const [group] = groupsOf(report([hidden]));
    expect(group!.rows[0]!.cells.map((cell) => cell.text)).toEqual(["Footnotes", "Do not send."]);
  });

  it("counts the values past the cap on a row of their own", () => {
    const comments: Finding = {
      ...finding("comments", 130),
      fields: [{ name: "M. Chen", value: { form: "text", text: "Cap?" } }],
      unlistedFieldCount: 129,
    };
    const rows = groupsOf(report([comments]))[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.cells[1]!.text).toBe("129 more not listed");
    expect(rows[1]!.cells).toHaveLength(3);
  });
});

describe("cleanCopyName", () => {
  it("marks the copy before the extension", () => {
    expect(cleanCopyName("Engagement Letter.docx")).toBe("Engagement Letter (clean).docx");
    expect(cleanCopyName("README")).toBe("README (clean)");
    expect(cleanCopyName(".hidden")).toBe(".hidden (clean)");
  });
});
