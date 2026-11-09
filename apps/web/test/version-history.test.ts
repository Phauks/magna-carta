import { describe, expect, it } from "vitest";
import type { MatterFileVersion } from "../src/lib/file-manager/matter-file-api.ts";
import type { VersionChange } from "../src/lib/file-manager/version-changes-api.ts";
import {
  changeAuthorText,
  changesSummaryText,
  changeTextSegments,
  createdByText,
  foldedCount,
  foldedLabel,
  groupChangesByPart,
  partLabel,
  saveKindText,
  versionsToShow,
} from "../src/lib/file-manager/version-history.ts";

const version = (over: Partial<MatterFileVersion>): MatterFileVersion => ({
  id: "fileVersion_01",
  versionNumber: 1,
  sizeBytes: 100,
  sniffedContentType: null,
  contentSha256: null,
  committedAt: "2026-09-18T10:00:00.000Z",
  uploadedBy: "user_ana",
  uploadedByName: "Ana Vasquez",
  saveKind: "explicit",
  participants: [{ userId: "user_ana", name: "Ana Vasquez" }],
  scanVerdict: "unscanned",
  scanEngineVersion: null,
  scanDetail: null,
  changes: [],
  ...over,
});

const change = (over: Partial<VersionChange>): VersionChange => ({
  sequence: 0,
  kind: "insertion",
  authorName: "Ana Vasquez",
  authorUserId: "user_ana",
  authorCurrentName: "Ana Vasquez-Reyes",
  changedAt: "2026-09-18T10:00:00.000Z",
  text: "the amended covenants",
  textTruncated: false,
  part: "word/document.xml",
  paragraphIndex: 0,
  ...over,
});

const HISTORY: readonly MatterFileVersion[] = [
  version({ id: "v5", versionNumber: 5, saveKind: "exit" }),
  version({ id: "v4", versionNumber: 4, saveKind: "autosave" }),
  version({ id: "v3", versionNumber: 3, saveKind: "autosave" }),
  version({ id: "v2", versionNumber: 2, saveKind: "explicit" }),
  version({ id: "v1", versionNumber: 1, saveKind: null }),
];

describe("versionsToShow", () => {
  it("folds only the autosaves, and shows everything when asked", () => {
    expect(versionsToShow(HISTORY, false).map((row) => row.id)).toEqual(["v5", "v2", "v1"]);
    expect(versionsToShow(HISTORY, true).map((row) => row.id)).toEqual([
      "v5",
      "v4",
      "v3",
      "v2",
      "v1",
    ]);
  });

  it("counts and names what it folded, in the singular where there is one", () => {
    expect(foldedCount(HISTORY)).toBe(2);
    expect(foldedLabel(2)).toBe("2 autosaves folded");
    expect(foldedLabel(1)).toBe("1 autosave folded");
  });
});

describe("saveKindText", () => {
  it("names every kind, and a version that did not come from the editor", () => {
    expect(saveKindText("explicit")).toBe("Saved");
    expect(saveKindText("autosave")).toBe("Autosaved");
    expect(saveKindText("exit")).toBe("Saved on close");
    expect(saveKindText("reap")).toBe("Saved when idle");
    expect(saveKindText(null)).toBe("Added");
  });
});

describe("createdByText", () => {
  it("names the creator alone when nobody else was there", () => {
    expect(createdByText(version({}))).toBe("Ana Vasquez");
  });

  it("names everyone else who was in the document, and never a blank for a departed member", () => {
    expect(
      createdByText(
        version({
          participants: [
            { userId: "user_ana", name: "Ana Vasquez" },
            { userId: "user_trevor", name: "Trevor Goldsmith" },
            { userId: "user_gone", name: null },
          ],
        }),
      ),
    ).toBe("Ana Vasquez · with Trevor Goldsmith, a former member");
  });
});

describe("changesSummaryText", () => {
  it("is empty where the version recorded nothing new", () => {
    expect(changesSummaryText(version({}))).toBe("");
  });

  it("states one clause per author, the zero parts left out, joined by a middle dot", () => {
    expect(
      changesSummaryText(
        version({
          changes: [
            {
              authorUserId: "user_ana",
              authorName: "Ana Vasquez",
              insertions: 3,
              deletions: 2,
              formatting: 1,
            },
            {
              authorUserId: null,
              authorName: "Trevor Goldsmith",
              insertions: 0,
              deletions: 0,
              formatting: 1,
            },
          ],
        }),
      ),
    ).toBe("Ana Vasquez: 3 added, 2 removed, 1 reformatted · Trevor Goldsmith: 1 reformatted");
  });

  it("keeps the shape at one, and drops an author whose tally is all zeros", () => {
    expect(
      changesSummaryText(
        version({
          changes: [
            {
              authorUserId: null,
              authorName: "Mira Chen",
              insertions: 1,
              deletions: 0,
              formatting: 0,
            },
            {
              authorUserId: null,
              authorName: "Nobody",
              insertions: 0,
              deletions: 0,
              formatting: 0,
            },
          ],
        }),
      ),
    ).toBe("Mira Chen: 1 added");
  });
});

describe("partLabel", () => {
  it("names the parts a reader knows, and leaves an unfamiliar one as the document names it", () => {
    expect(partLabel("word/document.xml")).toBe("Body");
    expect(partLabel("word/header1.xml")).toBe("Header");
    expect(partLabel("word/footer2.xml")).toBe("Footer");
    expect(partLabel("word/footnotes.xml")).toBe("Footnotes");
    expect(partLabel("word/endnotes.xml")).toBe("Endnotes");
    expect(partLabel("word/comments.xml")).toBe("Comments");
    expect(partLabel("word/glossary/document.xml")).toBe("Body");
    expect(partLabel("word/diagrams/data1.xml")).toBe("word/diagrams/data1.xml");
  });
});

describe("groupChangesByPart", () => {
  it("groups by part then paragraph, each in the order it first appears", () => {
    const grouped = groupChangesByPart([
      change({ sequence: 0, part: "word/document.xml", paragraphIndex: 2 }),
      change({ sequence: 1, part: "word/document.xml", paragraphIndex: 2, kind: "deletion" }),
      change({ sequence: 2, part: "word/document.xml", paragraphIndex: 5 }),
      change({ sequence: 3, part: "word/header1.xml", paragraphIndex: 0 }),
      change({ sequence: 4, part: "word/document.xml", paragraphIndex: 7 }),
    ]);
    expect(
      grouped.map((part) => ({
        label: part.label,
        paragraphs: part.paragraphs.map((paragraph) => ({
          index: paragraph.paragraphIndex,
          sequences: paragraph.changes.map((item) => item.sequence),
        })),
      })),
    ).toEqual([
      {
        label: "Body",
        paragraphs: [
          { index: 2, sequences: [0, 1] },
          { index: 5, sequences: [2] },
          { index: 7, sequences: [4] },
        ],
      },
      { label: "Header", paragraphs: [{ index: 0, sequences: [3] }] },
    ]);
  });

  it("groups nothing into nothing", () => {
    expect(groupChangesByPart([])).toEqual([]);
  });
});

describe("changeAuthorText", () => {
  it("reads the member's name today, and the document's name for a departed member", () => {
    expect(changeAuthorText(change({}))).toBe("Ana Vasquez-Reyes");
    expect(changeAuthorText(change({ authorUserId: null, authorCurrentName: null }))).toBe(
      "Ana Vasquez",
    );
  });
});

describe("changeTextSegments", () => {
  it("reads words as words and a newline as a paragraph break, dropping the empty run", () => {
    expect(changeTextSegments("one\ntwo")).toEqual([
      { kind: "words", text: "one" },
      { kind: "paragraph-break" },
      { kind: "words", text: "two" },
    ]);
    expect(changeTextSegments("\n")).toEqual([{ kind: "paragraph-break" }]);
    expect(changeTextSegments("end\n\n")).toEqual([
      { kind: "words", text: "end" },
      { kind: "paragraph-break" },
      { kind: "paragraph-break" },
    ]);
    expect(changeTextSegments("plain")).toEqual([{ kind: "words", text: "plain" }]);
  });
});
