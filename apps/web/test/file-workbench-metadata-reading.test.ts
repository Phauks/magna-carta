import { describe, expect, it } from "vitest";
import type { Finding, MetadataReport } from "@magna-carta/metadata";
import {
  cleanCopyName,
  groupsOf,
  leftBehind,
  optionsFrom,
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

describe("cleanCopyName", () => {
  it("marks the copy before the extension", () => {
    expect(cleanCopyName("Engagement Letter.docx")).toBe("Engagement Letter (clean).docx");
    expect(cleanCopyName("README")).toBe("README (clean)");
    expect(cleanCopyName(".hidden")).toBe(".hidden (clean)");
  });
});
