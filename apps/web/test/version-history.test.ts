import { describe, expect, it } from "vitest";
import type { MatterFileVersion } from "../src/lib/file-manager/matter-file-api.ts";
import {
  createdByText,
  foldedCount,
  foldedLabel,
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
