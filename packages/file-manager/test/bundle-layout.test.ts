import { describe, expect, it } from "vitest";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { ResolvedZip, ZipEntry } from "../src/zip-composition.ts";
import { applyBundleLayout } from "../src/bundle-layout.ts";

const entry = (path: string, id: string, size: number): ZipEntry => ({
  path,
  fileId: id as FileId,
  versionId: `${id}-v` as FileVersionId,
  r2Key: `files/${id}/${id}-v`,
  sizeBytes: size,
  exportCopy: { exportCopyState: null, exportR2Key: null, exportSizeBytes: null },
});

const resolved = (entries: ZipEntry[]): ResolvedZip => ({
  entries,
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
});

describe("applyBundleLayout", () => {
  it("preserveTree with no wrapper is a no-op on paths", () => {
    const input = resolved([entry("Pleadings/a.pdf", "f1", 10), entry("b.pdf", "f2", 20)]);
    const out = applyBundleLayout(input, { layout: "preserveTree", wrapperFolder: null });
    expect(out.entries.map((e) => e.path).sort()).toEqual(["Pleadings/a.pdf", "b.pdf"]);
    expect(out.totalBytes).toBe(30);
  });

  it("wraps every entry under the wrapper folder", () => {
    const input = resolved([entry("Pleadings/a.pdf", "f1", 10), entry("b.pdf", "f2", 20)]);
    const out = applyBundleLayout(input, {
      layout: "preserveTree",
      wrapperFolder: { name: "Smith v Jones" },
    });
    expect(out.entries.map((e) => e.path).sort()).toEqual([
      "Smith v Jones/Pleadings/a.pdf",
      "Smith v Jones/b.pdf",
    ]);
  });

  it("flatten collapses to basenames and disambiguates collisions", () => {
    const input = resolved([entry("Pleadings/a.pdf", "f1", 10), entry("Drafts/a.pdf", "f2", 20)]);
    const out = applyBundleLayout(input, { layout: "flatten", wrapperFolder: null });
    expect(out.entries.map((e) => e.path).sort()).toEqual(["a (1).pdf", "a.pdf"]);
    expect(out.fileCount).toBe(2);
  });

  it("flatten then wrap nests the flattened names under the wrapper", () => {
    const input = resolved([entry("x/a.pdf", "f1", 10)]);
    const out = applyBundleLayout(input, { layout: "flatten", wrapperFolder: { name: "Pkg" } });
    expect(out.entries.map((e) => e.path)).toEqual(["Pkg/a.pdf"]);
  });

  it("sanitizes illegal characters in the wrapper name", () => {
    const input = resolved([entry("a.pdf", "f1", 10)]);
    const out = applyBundleLayout(input, {
      layout: "preserveTree",
      wrapperFolder: { name: "Smith: v Jones?" },
    });
    expect(out.entries[0]?.path).toBe("Smith_ v Jones_/a.pdf");
  });
});
