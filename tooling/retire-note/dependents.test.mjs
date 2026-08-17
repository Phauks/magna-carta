import { describe, expect, it } from "vitest";
import { clearPointer, planRetirement, pointerIn } from "./dependents.mjs";

// The real shape of a status.d fragment, trimmed to the fields that matter here.
const fragment = (pointer) =>
  [
    "---",
    "slice: Tools area",
    "group: cross-cutting",
    "order: 7",
    "built: done",
    "branch: slice-0-7b-app-shell",
    `active-work:${pointer === null ? "" : ` ${pointer}`}`,
    "link-spec: docs/specs/2026-07-08-tools-listing-page-design.md",
    "---",
    "",
    "Body prose, which may itself cite docs/active-work/slice-0-7b-app-shell.md as a reference.",
    "",
  ].join("\n");

describe("pointerIn", () => {
  it("reads the pointer out of the frontmatter", () => {
    expect(pointerIn(fragment("docs/active-work/slice-0-7b-app-shell.md"))).toBe(
      "docs/active-work/slice-0-7b-app-shell.md",
    );
  });

  it("treats an empty pointer as no pointer", () => {
    expect(pointerIn(fragment(null))).toBeNull();
  });

  it("ignores a note path quoted in the body", () => {
    // The body of the fixture cites the same path. A pointer is a declaration the lint checks; a
    // citation is somebody's sentence, and rewriting it would be vandalism.
    const withoutPointer = fragment(null);
    expect(withoutPointer).toContain("cite docs/active-work/slice-0-7b-app-shell.md");
    expect(pointerIn(withoutPointer)).toBeNull();
  });

  it("returns null for a fragment with no frontmatter at all", () => {
    expect(pointerIn("just prose\n")).toBeNull();
  });
});

describe("clearPointer", () => {
  it("empties the value and keeps the key", () => {
    // Dropping the line would trade a dangling pointer for a parse failure — the same gate red for a
    // different reason.
    const cleared = clearPointer(fragment("docs/active-work/gone.md"));
    expect(cleared).toContain("\nactive-work:\n");
    expect(cleared).not.toContain("docs/active-work/gone.md\n");
  });

  it("leaves every other frontmatter line byte-identical", () => {
    const before = fragment("docs/active-work/gone.md").split("\n");
    const after = clearPointer(fragment("docs/active-work/gone.md")).split("\n");
    expect(after.length).toBe(before.length);
    for (const [index, line] of before.entries()) {
      if (line.startsWith("active-work:")) continue;
      expect(after[index]).toBe(line);
    }
  });

  it("leaves the body untouched", () => {
    expect(clearPointer(fragment("docs/active-work/slice-0-7b-app-shell.md"))).toContain(
      "cite docs/active-work/slice-0-7b-app-shell.md",
    );
  });
});

describe("planRetirement", () => {
  const fragments = [
    { path: "status.d/tools-area.md", text: fragment("docs/active-work/slice-0-7b-app-shell.md") },
    { path: "status.d/other.md", text: fragment("docs/active-work/somebody-else.md") },
    { path: "status.d/idle.md", text: fragment(null) },
  ];

  it("names only the fragments pointing at this note", () => {
    const plan = planRetirement({
      notePath: "docs/active-work/slice-0-7b-app-shell.md",
      fragments,
    });
    expect(plan.dependents.map((dependent) => dependent.path)).toEqual(["status.d/tools-area.md"]);
    expect(plan.dependents[0].pointer).toBe("docs/active-work/slice-0-7b-app-shell.md");
    expect(pointerIn(plan.dependents[0].text)).toBeNull();
  });

  it("finds nothing when no fragment points at the note", () => {
    const plan = planRetirement({ notePath: "docs/active-work/claude/nobody.md", fragments });
    expect(plan.dependents).toEqual([]);
  });

  it("matches a namespaced note written with backslashes or a leading ./", () => {
    // A match this misses is a dangling pointer and a red gate, so path spelling must not decide it.
    const namespaced = [
      { path: "status.d/a.md", text: fragment(".\\docs\\active-work\\claude\\fix-thing.md") },
      { path: "status.d/b.md", text: fragment("./docs/active-work/claude/fix-thing.md") },
    ];
    const plan = planRetirement({
      notePath: "docs/active-work/claude/fix-thing.md",
      fragments: namespaced,
    });
    expect(plan.dependents.map((dependent) => dependent.path)).toEqual([
      "status.d/a.md",
      "status.d/b.md",
    ]);
  });

  it("does not match a note whose name merely prefixes another", () => {
    const similar = [
      { path: "status.d/a.md", text: fragment("docs/active-work/claude/fix-thing-more.md") },
    ];
    const plan = planRetirement({
      notePath: "docs/active-work/claude/fix-thing.md",
      fragments: similar,
    });
    expect(plan.dependents).toEqual([]);
  });
});
