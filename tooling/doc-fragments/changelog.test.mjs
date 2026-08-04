import { describe, expect, it } from "vitest";
import { foldFragments, parseFragment } from "./changelog.mjs";

const changelog = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- Existing thing.",
  "",
].join("\n");

describe("parseFragment", () => {
  it("reads category from frontmatter and text from the body", () => {
    expect(parseFragment("---\ncategory: Fixed\n---\n\nA bug.\n")).toEqual({
      category: "Fixed",
      text: "A bug.",
    });
  });

  it("drops a leading list marker, which foldFragments is the one to add", () => {
    // Written as it would read in the file, the two markers stacked into `- - **The Oxlint...**`.
    expect(parseFragment("---\ncategory: Changed\n---\n\n- **A change.** Detail.\n").text).toBe(
      "**A change.** Detail.",
    );
  });

  it("drops the other list markers an author might reach for", () => {
    expect(parseFragment("---\ncategory: Added\n---\n\n* A thing.\n").text).toBe("A thing.");
    expect(parseFragment("---\ncategory: Added\n---\n\n+ A thing.\n").text).toBe("A thing.");
  });

  it("leaves a body that only starts with a dash-like character alone", () => {
    // An em dash opening a sentence is prose, not a bullet, and a marker needs its space.
    expect(parseFragment("---\ncategory: Added\n---\n\n-1 is now accepted.\n").text).toBe(
      "-1 is now accepted.",
    );
    expect(parseFragment("---\ncategory: Added\n---\n\n— a dash opener.\n").text).toBe(
      "— a dash opener.",
    );
  });

  it("strips only the FIRST marker, so a nested list inside the entry survives", () => {
    expect(parseFragment("---\ncategory: Added\n---\n\n- Top.\n  - Nested.\n").text).toBe(
      "Top.\n  - Nested.",
    );
  });
});

describe("foldFragments", () => {
  it("appends under an existing category", () => {
    const out = foldFragments(changelog, [{ category: "Added", text: "New thing." }]);
    expect(out).toContain("- Existing thing.\n- New thing.");
  });

  it("creates a missing category heading", () => {
    const out = foldFragments(changelog, [{ category: "Fixed", text: "A fix." }]);
    expect(out).toContain("### Fixed\n\n- A fix.");
  });

  it("folds multiple categories in one call", () => {
    const out = foldFragments(changelog, [
      { category: "Fixed", text: "A fix." },
      { category: "Added", text: "New thing." },
    ]);
    expect(out).toContain("- Existing thing.\n- New thing.");
    expect(out).toContain("### Fixed\n\n- A fix.");
  });

  it("renders exactly one bullet for a fragment the author wrote as a bullet", () => {
    const fragment = parseFragment("---\ncategory: Added\n---\n\n- **New thing.** Detail.\n");
    const out = foldFragments(changelog, [fragment]);
    expect(out).toContain("- **New thing.** Detail.");
    expect(out).not.toContain("- - ");
  });

  it("throws when the [Unreleased] section is missing", () => {
    const noUnreleased = "# Changelog\n\n## [1.0.0]\n\n### Added\n\n- Shipped.\n";
    expect(() => foldFragments(noUnreleased, [{ category: "Added", text: "x" }])).toThrow(
      /Unreleased/,
    );
  });
});
