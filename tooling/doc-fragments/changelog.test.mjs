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

  it("throws when the [Unreleased] section is missing", () => {
    const noUnreleased = "# Changelog\n\n## [1.0.0]\n\n### Added\n\n- Shipped.\n";
    expect(() => foldFragments(noUnreleased, [{ category: "Added", text: "x" }])).toThrow(
      /Unreleased/,
    );
  });
});
