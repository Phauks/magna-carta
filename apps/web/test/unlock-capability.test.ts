/*
 * Which containers the decryption engine actually reads, in the workbench's own vocabulary — pinned
 * because a wrong answer here would let a reader submit a rar or a legacy .doc and learn the truth
 * from a 400 instead of from the panel saying so up front.
 */
import { describe, expect, it } from "vitest";
import { unlockableFormatOf } from "../src/lib/tools/file-workbench/capabilities/unlock.ts";
import {
  FILE_TYPE_CAPABILITY,
  type WorkbenchFile,
} from "../src/lib/tools/file-workbench/workbench-file.ts";

function fileDetectedAs(label: string | null): WorkbenchFile {
  return {
    id: "test",
    name: "sample",
    sizeBytes: 0,
    declaredMediaType: "",
    receivedAt: new Date("2026-08-31T12:00:00Z"),
    preview: { kind: "none", reason: "a fixture draws nothing" },
    outcomes: {
      [FILE_TYPE_CAPABILITY]: {
        kind: "result",
        value: {
          report: {
            detected: label,
            detectedLabel: label ?? "unknown",
            group: "document",
            confidence: 1,
            claimedExtension: null,
            extensionMatch: "match",
            recommendedExtensions: [],
            note: "",
          },
          provenance: "prefix-scan",
          magicBytes: "",
        },
      },
    },
    readBytes: () => Promise.resolve(new Uint8Array(0)),
  };
}

describe("unlockableFormatOf", () => {
  it("answers the three containers the decryption engine reads", () => {
    expect(unlockableFormatOf(fileDetectedAs("pdf"))).toBe("pdf");
    expect(unlockableFormatOf(fileDetectedAs("zip"))).toBe("zip");
    expect(unlockableFormatOf(fileDetectedAs("docx"))).toBe("ooxml");
    expect(unlockableFormatOf(fileDetectedAs("xlsx"))).toBe("ooxml");
    expect(unlockableFormatOf(fileDetectedAs("pptx"))).toBe("ooxml");
  });

  it("says no for a container the engine cannot open yet, without claiming it is not lockable", () => {
    // Each of these still applies() as password-protectable (file-facts.ts), so the panel renders
    // and has to say the real reason itself rather than being hidden entirely.
    expect(unlockableFormatOf(fileDetectedAs("doc"))).toBeNull();
    expect(unlockableFormatOf(fileDetectedAs("sevenzip"))).toBeNull();
    expect(unlockableFormatOf(fileDetectedAs("rar"))).toBeNull();
    expect(unlockableFormatOf(fileDetectedAs("tar"))).toBeNull();
    expect(unlockableFormatOf(fileDetectedAs("gzip"))).toBeNull();
  });

  it("says no for a file that has not been identified yet", () => {
    expect(unlockableFormatOf(fileDetectedAs(null))).toBeNull();
  });
});
