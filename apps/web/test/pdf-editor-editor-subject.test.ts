import { describe, expect, it } from "vitest";
import {
  benchSubject,
  changedCopyName,
  editorToolsFor,
  matterOf,
  matterSubject,
  putMadeOnBench,
  savesVersions,
  toolAvailability,
} from "../src/lib/pdf-editor/editor-subject.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

const benchFile = {
  name: "Lease.pdf",
  sizeBytes: 1200,
  readBytes: () => Promise.resolve(new Uint8Array([37, 80, 68, 70])),
};

describe("a bench file in the PDF Editor", () => {
  it("is on no matter and keeps no versions", () => {
    const subject = benchSubject(benchFile, () => {});
    expect(subject.name).toBe("Lease.pdf");
    expect(matterOf(subject)).toBeNull();
    expect(savesVersions(subject)).toBe(false);
  });

  it("puts what the engine made on the bench, under the name it was given, as a PDF", async () => {
    const put: File[] = [];
    const subject = benchSubject(benchFile, (made) => put.push(made));
    const name = putMadeOnBench(subject, new Uint8Array([1, 2, 3]), "Lease (Redacted).pdf");
    expect(name).toBe("Lease (Redacted).pdf");
    expect(put).toHaveLength(1);
    expect(put[0]?.name).toBe("Lease (Redacted).pdf");
    expect(put[0]?.type).toBe("application/pdf");
    expect(new Uint8Array(await put[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("names a changed copy for the change, where a matter file would take a version", () => {
    expect(changedCopyName("Lease.pdf", "Arranged")).toBe("Lease (Arranged).pdf");
    expect(changedCopyName("Lease", "Filled")).toBe("Lease (Filled).pdf");
  });

  it("leaves Signature off and shuts Bates with its reason", () => {
    expect(editorToolsFor("bench").map((tool) => tool.id)).toEqual([
      "pages",
      "redact",
      "forms",
      "bates",
      "watermark",
      "secure",
    ]);
    const bates = toolAvailability("bates", "bench");
    expect(bates.available).toBe(false);
    expect(bates.available ? "" : bates.reason).toMatch(/matter/);
    for (const tool of ["pages", "redact", "forms", "watermark", "secure"] as const) {
      expect(toolAvailability(tool, "bench").available).toBe(true);
    }
  });
});

describe("a matter file in the PDF Editor", () => {
  it("offers every tool, and keeps versions", () => {
    const file = { id: "file_1", name: "Brief.pdf", matterId: "matter_1" } as MatterFile;
    const subject = matterSubject(file);
    expect(matterOf(subject)).toBe(file);
    expect(savesVersions(subject)).toBe(true);
    expect(editorToolsFor("matter").map((tool) => tool.id)).toContain("signature");
    expect(toolAvailability("bates", "matter").available).toBe(true);
  });
});
