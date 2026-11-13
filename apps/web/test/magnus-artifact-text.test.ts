import { describe, expect, it } from "vitest";
import {
  artifactFileName,
  changedParagraphs,
  countMatches,
  paragraphsOf,
  versionOrigin,
  versionsWrittenBy,
} from "../src/lib/magnus/artifact-text.ts";
import type { MagnusArtifact, MagnusArtifactVersion } from "../src/lib/magnus/magnus-api.ts";

function version(
  versionNumber: number,
  overrides: Partial<MagnusArtifactVersion> = {},
): MagnusArtifactVersion {
  return {
    versionNumber,
    note: null,
    writtenByTurnId: `magnusTurn_${versionNumber}`,
    memberUserId: "user_a",
    restoredFromVersion: null,
    createdAt: "2026-11-13T10:00:00.000Z",
    bytes: 10,
    ...overrides,
  };
}

describe("a document's text in the pane", () => {
  it("splits paragraphs on blank lines and keeps line breaks inside one", () => {
    expect(paragraphsOf("Dear Sir,\n\nLine one\nline two\n\n\nYours")).toEqual([
      "Dear Sir,",
      "Line one\nline two",
      "Yours",
    ]);
  });

  it("marks the paragraphs that are not in the version before", () => {
    const changed = changedParagraphs("A\n\nB changed\n\nC", "A\n\nB\n\nC");
    expect([...changed]).toEqual([1]);
    expect(changedParagraphs("A", null).size).toBe(0);
  });

  it("counts the reader's words ignoring case", () => {
    expect(countMatches("Clause 12 and clause 14", "CLAUSE")).toBe(2);
    expect(countMatches("anything", "  ")).toBe(0);
  });

  it("names a download after the document and its version, without path characters", () => {
    expect(artifactFileName("Notice: Breach/Cure", 3, "md")).toBe(
      "Notice Breach Cure (version 3).md",
    );
  });

  it("says how a version came to be, and finds the versions an answer wrote", () => {
    expect(versionOrigin(version(1), "Priya Shah")).toBe("Magnus, asked by Priya Shah");
    expect(versionOrigin(version(3, { restoredFromVersion: 1 }), "Priya Shah")).toBe(
      "Priya Shah restored version 1",
    );
    const artifact: MagnusArtifact = {
      id: "magnusArtifact_a",
      title: "Letter",
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:00.000Z",
      versions: [version(1), version(2)],
    };
    expect(
      versionsWrittenBy([artifact], "magnusTurn_2").map((w) => w.version.versionNumber),
    ).toEqual([2]);
  });
});
