import { describe, expect, it } from "vitest";
import {
  rebaseLinks,
  collectFragments,
  containsEmoji,
  ensureDatedSection,
  foldFragments,
  parseFragment,
  validateFragment,
} from "./changelog.mjs";

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

const publicChangelog = ["# Product changelog", "", "Some preamble prose.", ""].join("\n");

function fragment(frontmatter, body) {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe("parseFragment", () => {
  it("reads category, audience, and the entry text", () => {
    expect(parseFragment(fragment("category: Fixed\naudience: internal", "A bug."))).toEqual({
      category: "Fixed",
      audience: "internal",
      text: "A bug.",
      publicText: null,
    });
  });

  it("splits the customer entry out at the public heading", () => {
    const parsed = parseFragment(
      fragment(
        "category: Added\naudience: public",
        "The developer half, with mechanism.\n\n## Public\n\nThe customer half.",
      ),
    );
    expect(parsed.text).toBe("The developer half, with mechanism.");
    expect(parsed.publicText).toBe("The customer half.");
  });

  it("distinguishes an absent public block from an empty one, which validate treats differently", () => {
    expect(parseFragment(fragment("category: Added\naudience: public", "Body.")).publicText).toBe(
      null,
    );
    expect(
      parseFragment(fragment("category: Added\naudience: public", "Body.\n\n## Public\n"))
        .publicText,
    ).toBe("");
  });

  it("drops a leading list marker on both halves, which foldFragments is the one to add", () => {
    // Written as it would read in the file, the two markers stacked into `- - **The Oxlint...**`.
    const parsed = parseFragment(
      fragment(
        "category: Changed\naudience: public",
        "- **A change.** Detail.\n\n## Public\n\n- **A change.**",
      ),
    );
    expect(parsed.text).toBe("**A change.** Detail.");
    expect(parsed.publicText).toBe("**A change.**");
  });

  it("drops the other list markers an author might reach for", () => {
    expect(parseFragment(fragment("category: Added\naudience: internal", "* A thing.")).text).toBe(
      "A thing.",
    );
    expect(parseFragment(fragment("category: Added\naudience: internal", "+ A thing.")).text).toBe(
      "A thing.",
    );
  });

  it("leaves a body that only starts with a dash-like character alone", () => {
    // An em dash opening a sentence is prose, not a bullet, and a marker needs its space.
    expect(
      parseFragment(fragment("category: Added\naudience: internal", "-1 is now accepted.")).text,
    ).toBe("-1 is now accepted.");
    expect(
      parseFragment(fragment("category: Added\naudience: internal", "— a dash opener.")).text,
    ).toBe("— a dash opener.");
  });

  it("strips only the FIRST marker, so a nested list inside the entry survives", () => {
    expect(
      parseFragment(fragment("category: Added\naudience: internal", "- Top.\n  - Nested.")).text,
    ).toBe("Top.\n  - Nested.");
  });

  it("throws on a fragment that opens with prose instead of frontmatter", () => {
    expect(() => parseFragment("A change happened.\n", "changelog.d/x.md")).toThrow(
      /missing the opening/,
    );
  });

  it("throws on an unclosed frontmatter fence", () => {
    expect(() => parseFragment("---\ncategory: Added\n", "changelog.d/x.md")).toThrow(
      /missing the closing/,
    );
  });

  it("throws on an unknown frontmatter key rather than ignoring it", () => {
    // A key that is quietly dropped is how a fragment ends up with an audience nobody set.
    expect(() =>
      parseFragment(fragment("category: Added\naudiance: public", "Body."), "changelog.d/x.md"),
    ).toThrow(/unknown frontmatter line/);
  });
});

describe("validateFragment", () => {
  const problemsFor = (frontmatter, body) =>
    validateFragment(parseFragment(fragment(frontmatter, body)), "x.md");

  it("accepts a well-formed internal fragment", () => {
    expect(problemsFor("category: Added\naudience: internal", "Body.")).toEqual([]);
  });

  it("accepts a well-formed public fragment", () => {
    expect(
      problemsFor("category: Added\naudience: public", "Body.\n\n## Public\n\nCustomer body."),
    ).toEqual([]);
  });

  it("refuses a fragment with no audience, in either direction", () => {
    expect(problemsFor("category: Added", "Body.").join()).toMatch(/no `audience:`/);
  });

  it("refuses an audience outside the two", () => {
    expect(problemsFor("category: Added\naudience: everyone", "Body.").join()).toMatch(
      /audience "everyone"/,
    );
  });

  it("refuses a public fragment with no public block", () => {
    expect(problemsFor("category: Added\naudience: public", "Body.").join()).toMatch(
      /carries no `## Public` block/,
    );
  });

  it("refuses a public fragment whose public block is empty", () => {
    expect(problemsFor("category: Added\naudience: public", "Body.\n\n## Public\n").join()).toMatch(
      /carries no `## Public` block/,
    );
  });

  it("refuses an internal fragment carrying a public block nothing would read", () => {
    expect(
      problemsFor("category: Added\naudience: internal", "Body.\n\n## Public\n\nOrphaned.").join(),
    ).toMatch(/carries a `## Public` block/);
  });

  it("refuses a missing or unknown category", () => {
    expect(problemsFor("audience: internal", "Body.").join()).toMatch(/no `category:`/);
    expect(problemsFor("category: Improved\naudience: internal", "Body.").join()).toMatch(
      /category "Improved"/,
    );
  });

  it("refuses an entry with no text", () => {
    expect(problemsFor("category: Added\naudience: internal", "").join()).toMatch(/no entry text/);
  });

  it("refuses an emoji in either half", () => {
    expect(problemsFor("category: Added\naudience: internal", "A rocket 🚀 ships.").join()).toMatch(
      /contains an emoji/,
    );
    expect(
      problemsFor(
        "category: Added\naudience: public",
        "Clean body.\n\n## Public\n\nA sparkle ✨ here.",
      ).join(),
    ).toMatch(/contains an emoji/);
  });

  it("reports every problem in one file at once, so one run fixes the file", () => {
    expect(problemsFor("", "").length).toBeGreaterThan(2);
  });
});

describe("containsEmoji", () => {
  it("finds emoji-presentation characters and variation-selected ones", () => {
    expect(containsEmoji("a rocket 🚀")).toBe(true);
    expect(containsEmoji("a check ✔️")).toBe(true);
  });

  it("leaves the typographic signs that legitimately appear in prose", () => {
    // The wrong test here is Extended_Pictographic, which covers all three of these.
    expect(containsEmoji("Magna Carta™")).toBe(false);
    expect(containsEmoji("© 2026")).toBe(false);
    expect(containsEmoji("registered ®")).toBe(false);
  });
});

describe("collectFragments", () => {
  it("returns records for a sound set and no problems", () => {
    const { records, problems } = collectFragments([
      {
        key: "a.md",
        context: "a.md",
        markdown: fragment("category: Added\naudience: internal", "A."),
      },
      {
        key: "b.md",
        context: "b.md",
        markdown: fragment("category: Fixed\naudience: internal", "B."),
      },
    ]);
    expect(problems).toEqual([]);
    expect([...records.keys()]).toEqual(["a.md", "b.md"]);
  });

  it("reports every offending file rather than stopping at the first", () => {
    const { records, problems } = collectFragments([
      { key: "a.md", context: "a.md", markdown: "no frontmatter\n" },
      { key: "b.md", context: "b.md", markdown: fragment("category: Added", "B.") },
      {
        key: "c.md",
        context: "c.md",
        markdown: fragment("category: Added\naudience: internal", "C."),
      },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.join()).toMatch(/a\.md/);
    expect(problems.join()).toMatch(/b\.md/);
    // The sound fragment is still collected; the caller decides that any problem stops the run.
    expect([...records.keys()]).toEqual(["c.md"]);
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
    const parsed = parseFragment(
      fragment("category: Added\naudience: internal", "- **New thing.** Detail."),
    );
    const out = foldFragments(changelog, [parsed]);
    expect(out).toContain("- **New thing.** Detail.");
    expect(out).not.toContain("- - ");
  });

  it("throws when the target section is missing", () => {
    const noUnreleased = "# Changelog\n\n## [1.0.0]\n\n### Added\n\n- Shipped.\n";
    expect(() => foldFragments(noUnreleased, [{ category: "Added", text: "x" }])).toThrow(
      /Unreleased/,
    );
  });

  it("folds into a dated section when one is named, which is how the public home is assembled", () => {
    const dated = ensureDatedSection(publicChangelog, "2026-08-12");
    const out = foldFragments(
      dated,
      [{ category: "Added", text: "A visible change." }],
      "## 2026-08-12",
    );
    expect(out).toContain("## 2026-08-12\n\n### Added\n\n- A visible change.");
  });
});

describe("ensureDatedSection", () => {
  it("opens the first dated section below the preamble", () => {
    const out = ensureDatedSection(publicChangelog, "2026-08-12");
    expect(out).toContain("Some preamble prose.\n\n## 2026-08-12");
  });

  it("inserts a newer date above the newest existing one, keeping the document reverse-chronological", () => {
    const existing = ensureDatedSection(publicChangelog, "2026-08-11");
    const out = ensureDatedSection(existing, "2026-08-12");
    expect(out.indexOf("## 2026-08-12")).toBeLessThan(out.indexOf("## 2026-08-11"));
  });

  it("is a no-op for a date already present, so a second assembly the same day appends", () => {
    const existing = ensureDatedSection(publicChangelog, "2026-08-12");
    expect(ensureDatedSection(existing, "2026-08-12")).toBe(existing);
  });
});

describe("rebaseLinks", () => {
  it("drops the fragment's climb for the root changelog, and leaves absolute links and anchors alone", () => {
    const text =
      "See [the spec](../docs/specs/x.md), [the site](https://example.com) and [below](#here).";
    expect(rebaseLinks(text, "developer")).toBe(
      "See [the spec](docs/specs/x.md), [the site](https://example.com) and [below](#here).",
    );
  });

  it("rebases into docs/ for the public changelog, whichever way the fragment wrote the link", () => {
    expect(rebaseLinks("[guide](../docs/user/features/x.md)", "public")).toBe(
      "[guide](user/features/x.md)",
    );
    expect(rebaseLinks("[guide](docs/user/features/x.md)", "public")).toBe(
      "[guide](user/features/x.md)",
    );
    expect(rebaseLinks("[tool](../tooling/x.mjs)", "public")).toBe("[tool](../tooling/x.mjs)");
  });
});
