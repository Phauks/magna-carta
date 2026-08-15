import { describe, expect, it } from "vitest";
import { branchFromNotePath, findOverlaps, isUnreadable, parseNote } from "./parse-note.mjs";

const note = [
  "---",
  "worktree: C:/dev/magna-carta-worktrees/slice-1-4",
  "area: custom-fields engine",
  "status: building",
  "touches: packages/custom-fields, STATUS.md, docs/Decision-Log.md",
  "---",
  "",
  "Scope paragraph.",
  "",
].join("\n");

describe("branchFromNotePath", () => {
  it("reads a namespaced branch back out of its subdirectory path", () => {
    expect(branchFromNotePath("docs/active-work/claude/fix-thing.md")).toBe("claude/fix-thing");
  });

  it("reads a top-level note as an unnamespaced branch", () => {
    expect(branchFromNotePath("docs/active-work/slice-0-7b.md")).toBe("slice-0-7b");
  });

  it("takes backslashes, which is what the OS hands back on Windows", () => {
    expect(branchFromNotePath("docs\\active-work\\claude\\fix-thing.md")).toBe("claude/fix-thing");
  });
});

describe("parseNote", () => {
  it("reads the frontmatter keys and splits touches into a trimmed list", () => {
    expect(parseNote(note, "slice-1-4")).toEqual({
      branch: "slice-1-4",
      worktree: "C:/dev/magna-carta-worktrees/slice-1-4",
      area: "custom-fields engine",
      status: "building",
      touches: ["packages/custom-fields", "STATUS.md", "docs/Decision-Log.md"],
      malformed: false,
    });
  });

  it("returns empty touches when the field is absent or blank", () => {
    const minimal = ["---", "touches:", "---", "", "body"].join("\n");
    expect(parseNote(minimal, "x").touches).toEqual([]);
  });

  it("keeps the branch the path gave it, so a malformed note still has an identity", () => {
    // The registry names an unreadable note by its file. That is only possible if parsing a broken
    // one still yields the branch — otherwise every such note collapses onto the same empty key and
    // all but one are silently discarded, which is how nineteen of them went unnoticed.
    const parsed = parseNote("no frontmatter here", "claude/some-stream");
    expect(parsed.branch).toBe("claude/some-stream");
    expect(isUnreadable(parsed)).toBe(true);
  });

  it("treats an unterminated frontmatter block as unreadable rather than half-parsing it", () => {
    const parsed = parseNote(["---", "touches: packages/foo", "", "body"].join("\n"), "b");
    expect(isUnreadable(parsed)).toBe(true);
    expect(parsed.touches).toEqual([]);
  });

  it("reads a well-formed note as readable", () => {
    expect(isUnreadable(parseNote(note, "slice-1-4"))).toBe(false);
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

  it("reports nothing for a single stream, however many streams have finished around it", () => {
    // The caller filters to streams in flight, and the reason is this: one live stream can collide
    // with nobody. Fed the finished ones too, the same call reports collisions among branches that
    // will never be edited again — which was every entry this section printed.
    expect(findOverlaps([{ branch: "live", touches: ["STATUS.md", "ROADMAP.md"] }])).toEqual([]);
  });
});
