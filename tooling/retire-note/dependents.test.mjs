import { describe, expect, it } from "vitest";
import { clearPointer, planRetirement, pointerIn, retirementRefusal } from "./dependents.mjs";

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

// The guard decides between two workflows that look alike and are not: retiring a note after its
// work landed (the deletion takes effect at once) and retiring it in the pull request that lands the
// work (the deletion travels with the merge). The landing check is right for the first and cannot
// even be satisfied by the second, which is what these pin.
describe("retirementRefusal", () => {
  const landed = { branch: "claude/thing", noteExists: true, hasLanded: true };
  const inFlight = { branch: "claude/thing", noteExists: true, hasLanded: false };

  it("allows retiring a note whose branch has landed", () => {
    expect(retirementRefusal(landed)).toBeNull();
  });

  it("refuses an unlanded branch, and names --with-merge as the other way", () => {
    const refusal = retirementRefusal(inFlight);
    expect(refusal).toContain("has not landed");
    expect(refusal).toContain("--with-merge");
    expect(refusal).toContain("--force");
  });

  it("still lets --force retire an abandoned stream", () => {
    expect(retirementRefusal({ ...inFlight, force: true })).toBeNull();
  });

  it("allows --with-merge on an unlanded branch, which is the whole point of it", () => {
    // A branch cannot have landed while the pull request landing it is still open, so requiring
    // that here would make the flag unusable in the only situation it exists for.
    expect(
      retirementRefusal({ ...inFlight, withMerge: true, headBranch: "claude/thing" }),
    ).toBeNull();
  });

  it("refuses --with-merge from any branch but the note's own", () => {
    // The deletion only travels with the merge if it is committed on the branch being merged.
    const refusal = retirementRefusal({
      ...inFlight,
      withMerge: true,
      headBranch: "main",
    });
    expect(refusal).toContain("has to run on claude/thing");
    expect(refusal).toContain("HEAD is on main");
  });

  it("refuses --with-merge on a detached HEAD, saying so in those words", () => {
    const refusal = retirementRefusal({ ...inFlight, withMerge: true, headBranch: null });
    expect(refusal).toContain("not on any branch");
  });

  it("refuses when there is no note, no pointer and no workspace", () => {
    const refusal = retirementRefusal({
      branch: "claude/typo",
      noteExists: false,
      hasLanded: true,
    });
    expect(refusal).toContain("nothing to retire");
    expect(refusal).toContain("mirrors its branch exactly");
  });

  it("proceeds on a workspace alone — the state --with-merge leaves behind once it lands", () => {
    // Note gone, pointers cleared, worktree and branch still here. Refusing this would mean the
    // cleanup pass is turned away by the retirement that worked.
    expect(
      retirementRefusal({
        branch: "claude/thing",
        noteExists: false,
        hasLanded: true,
        hasWorkspace: true,
      }),
    ).toBeNull();
  });

  it("proceeds on a dangling pointer alone, with the note already gone", () => {
    expect(
      retirementRefusal({
        branch: "claude/thing",
        noteExists: false,
        hasLanded: true,
        dependentCount: 1,
      }),
    ).toBeNull();
  });

  it("says a branch resolves to no ref, which is a different mistake from an unlanded one", () => {
    const refusal = retirementRefusal({ ...inFlight, branchUnknown: true });
    expect(refusal).toContain("resolves to no ref");
  });
});
