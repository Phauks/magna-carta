/*
 * The Changelog screen's two halves: the real document, built into the bundle, reaches the screen
 * as dated releases; and an entry's Markdown becomes nodes the screen draws as text, never as
 * markup.
 */
import { describe, expect, it } from "vitest";
import { publicChangelogReleases } from "../src/lib/product-updates/public-changelog.ts";
import {
  parseChangelogInline,
  parseChangelogText,
} from "../src/lib/product-updates/changelog-text.ts";

describe("the changelog built into the bundle", () => {
  const releases = publicChangelogReleases();

  it("holds the document's releases, newest first", () => {
    expect(releases.length).toBeGreaterThan(0);
    const dates = releases.map((release) => release.date);
    expect(dates).toEqual(dates.toSorted().toReversed());
  });

  it("gives every release at least one category with at least one entry", () => {
    for (const release of releases) {
      expect(release.categories.length).toBeGreaterThan(0);
      for (const group of release.categories) expect(group.entries.length).toBeGreaterThan(0);
    }
  });

  it("parses every entry in the document into at least one paragraph", () => {
    for (const release of releases) {
      for (const group of release.categories) {
        for (const entry of group.entries) {
          expect(parseChangelogText(entry.text).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("an entry's text", () => {
  it("splits paragraphs on a blank line and reads a wrapped line as a space", () => {
    const paragraphs = parseChangelogText("First line\n  continues here.\n\nSecond paragraph.");
    expect(paragraphs).toEqual([
      [{ kind: "text", text: "First line continues here." }],
      [{ kind: "text", text: "Second paragraph." }],
    ]);
  });

  it("reads bold, code and emphasis, nested", () => {
    expect(parseChangelogInline("**Use `C2026-0001` now.** Then _carry on_.")).toEqual([
      {
        kind: "strong",
        children: [
          { kind: "text", text: "Use " },
          { kind: "code", text: "C2026-0001" },
          { kind: "text", text: " now." },
        ],
      },
      { kind: "text", text: " Then " },
      { kind: "emphasis", children: [{ kind: "text", text: "carry on" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps a link's words and drops its repository-relative address", () => {
    expect(
      parseChangelogInline("New guide: [The firm's fees](user/features/the-firms-fees.md)."),
    ).toEqual([{ kind: "text", text: "New guide: The firm's fees." }]);
  });

  it("leaves an unclosed delimiter and a snake_case name as written", () => {
    expect(parseChangelogInline("a **loose star and a matter_number")).toEqual([
      { kind: "text", text: "a **loose star and a matter_number" },
    ]);
  });

  it("treats markup in the document as text", () => {
    expect(parseChangelogInline("<script>alert(1)</script>")).toEqual([
      { kind: "text", text: "<script>alert(1)</script>" },
    ]);
  });
});
