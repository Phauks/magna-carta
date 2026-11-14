import type { MagnusArtifactId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_LEFT_OUT_NOTE,
  extractDocuments,
  layOutCurrentDocuments,
  titleKey,
} from "../src/artifact.ts";
import { ARTIFACTS_WINDOW_MAX_BYTES, ARTIFACT_VERSION_MAX_BYTES } from "../src/limits.ts";

const ID = "magnusArtifact_000000000000000000000" as MagnusArtifactId;

describe("taking documents out of an answer", () => {
  it("keeps Magnus's words and each document apart", () => {
    const extracted = extractDocuments(
      'Here is a draft.\n<document title="Notice of Breach">\nDear Sir,\n\nYou are in breach.\n</document>\nFill in the date.',
    );
    expect(extracted.documents).toEqual([
      { title: "Notice of Breach", note: null, content: "Dear Sir,\n\nYou are in breach." },
    ]);
    expect(extracted.prose).toBe("Here is a draft.\n\nFill in the date.");
    expect(extracted.leftOut).toBe(0);
  });

  it("reads a version note, and says what it did when the answer was only a document", () => {
    const extracted = extractDocuments(
      '<document title="Timeline" note="adds the March hearing">\n1 March: hearing\n</document>',
    );
    expect(extracted.documents[0]?.note).toBe("adds the March hearing");
    expect(extracted.prose).toBe('Wrote "Timeline".');
  });

  it("leaves an unclosed block in the answer as text", () => {
    const answer = 'Starting.\n<document title="Cut off">\nhalf a letter';
    const extracted = extractDocuments(answer);
    expect(extracted.documents).toEqual([]);
    expect(extracted.prose).toBe(answer);
  });

  it("leaves out a document over the cap, and one past three, and says so", () => {
    const long = "x".repeat(ARTIFACT_VERSION_MAX_BYTES + 1);
    const blocks = [long, "a", "b", "c", "d"]
      .map((body, index) => `<document title="D${index}">\n${body}\n</document>`)
      .join("\n");
    const extracted = extractDocuments(blocks);
    expect(extracted.documents.map((document) => document.title)).toEqual(["D1", "D2", "D3"]);
    expect(extracted.leftOut).toBe(2);
    expect(extracted.prose).toContain(DOCUMENT_LEFT_OUT_NOTE);
  });

  it("matches titles regardless of case and spacing", () => {
    expect(titleKey("  Notice   of Breach ")).toBe(titleKey("notice of breach"));
  });
});

describe("laying out the conversation's documents for the model", () => {
  it("names each with its version, and cuts the one that does not fit", () => {
    const text = layOutCurrentDocuments([
      { id: ID, title: "Letter", versionNumber: 2, content: "Dear Sir" },
      {
        id: ID,
        title: "Long",
        versionNumber: 1,
        content: "y".repeat(ARTIFACTS_WINDOW_MAX_BYTES),
      },
      { id: ID, title: "Named only", versionNumber: 4, content: "never sent" },
    ]);
    expect(text).toContain("--- Document in this conversation: Letter (version 2) ---\nDear Sir");
    expect(text).toContain("[The rest of this document did not fit and was not sent.]");
    expect(text).toContain("--- Document in this conversation: Named only (version 4) ---");
    expect(text).not.toContain("never sent");
  });
});
