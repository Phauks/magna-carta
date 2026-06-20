import { describe, expect, it } from "vitest";
import { findOverlaps, parseNote } from "./parse-note.mjs";

const note = [
  "---",
  "branch: slice-1-4",
  "worktree: C:/dev/magna-carta-worktrees/slice-1-4",
  "area: custom-fields engine",
  "status: building",
  "touches: packages/custom-fields, STATUS.md, docs/Decision-Log.md",
  "---",
  "",
  "Scope paragraph.",
  "",
].join("\n");

describe("parseNote", () => {
  it("reads the frontmatter keys and splits touches into a trimmed list", () => {
    expect(parseNote(note)).toEqual({
      branch: "slice-1-4",
      worktree: "C:/dev/magna-carta-worktrees/slice-1-4",
      area: "custom-fields engine",
      status: "building",
      touches: ["packages/custom-fields", "STATUS.md", "docs/Decision-Log.md"],
    });
  });

  it("returns empty touches when the field is absent or blank", () => {
    const minimal = ["---", "branch: x", "touches:", "---", "", "body"].join("\n");
    expect(parseNote(minimal).touches).toEqual([]);
  });

  it("returns a blank record when there is no frontmatter", () => {
    expect(parseNote("no frontmatter here").branch).toBe("");
  });
});

describe("findOverlaps", () => {
  it("reports only paths touched by more than one stream, with sorted branches", () => {
    const notes = [
      { branch: "b", touches: ["STATUS.md", "packages/b"] },
      { branch: "a", touches: ["STATUS.md", "ROADMAP.md"] },
      { branch: "c", touches: ["packages/c"] },
    ];
    expect(findOverlaps(notes)).toEqual([{ path: "STATUS.md", branches: ["a", "b"] }]);
  });

  it("returns nothing when no paths are shared", () => {
    expect(
      findOverlaps([
        { branch: "a", touches: ["x"] },
        { branch: "b", touches: ["y"] },
      ]),
    ).toEqual([]);
  });
});
