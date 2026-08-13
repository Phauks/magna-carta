import { describe, expect, it } from "vitest";
import {
  PublicChangelogParseError,
  buildPublicChangelogArtifact,
  parsePublicChangelog,
} from "../src/public-changelog.ts";
import { CHANGELOG_CATEGORIES, SCHEMA_VERSION, groupIntoReleases } from "../src/schema.ts";

const preamble = ["# Product changelog", "", "What changed, for the people who use it.", ""];

function document(...sections: string[]): string {
  return [...preamble, ...sections].join("\n");
}

describe("parsePublicChangelog", () => {
  it("reads dated sections, categories, and entries", () => {
    const entries = parsePublicChangelog(
      document(
        "## 2026-08-12",
        "",
        "### Added",
        "",
        "- A matter's documents now have a working screen.",
        "",
        "### Fixed",
        "",
        "- A refused invitation no longer says whether the code exists.",
        "",
        "## 2026-08-01",
        "",
        "### Added",
        "",
        "- Trust accounts record bank charges.",
        "",
      ),
    );
    expect(entries).toEqual([
      {
        date: "2026-08-12",
        version: null,
        category: "Added",
        text: "A matter's documents now have a working screen.",
      },
      {
        date: "2026-08-12",
        version: null,
        category: "Fixed",
        text: "A refused invitation no longer says whether the code exists.",
      },
      {
        date: "2026-08-01",
        version: null,
        category: "Added",
        text: "Trust accounts record bank charges.",
      },
    ]);
  });

  it("ignores the document's prose preamble rather than carrying it into the artifact", () => {
    expect(parsePublicChangelog(document())).toEqual([]);
  });

  it("carries an entry that runs over several lines", () => {
    const entries = parsePublicChangelog(
      document("## 2026-08-12", "", "### Added", "", "- First line.", "  Second line.", ""),
    );
    expect(entries[0]?.text).toBe("First line.\n  Second line.");
  });

  it("reads the versioned heading shape, so cutting a release is an edit to the document", () => {
    const entries = parsePublicChangelog(
      document("## [1.4.0] - 2026-08-12", "", "### Added", "", "- Something.", ""),
    );
    expect(entries[0]).toMatchObject({ date: "2026-08-12", version: "1.4.0" });
  });

  it("refuses an entry above the first release heading instead of dropping it", () => {
    // The failure this guards is silent omission: a shipped change that renders nowhere.
    expect(() => parsePublicChangelog(document("- An orphaned entry.", ""))).toThrow(
      PublicChangelogParseError,
    );
  });

  it("refuses an entry under a release but outside any category", () => {
    expect(() => parsePublicChangelog(document("## 2026-08-12", "", "- No category.", ""))).toThrow(
      /outside a dated release and category section/,
    );
  });

  it("refuses a category heading that is not a changelog category", () => {
    expect(() =>
      parsePublicChangelog(document("## 2026-08-12", "", "### Improvements", "", "- A thing.", "")),
    ).toThrow(/"Improvements" is not a changelog category/);
  });

  it("refuses a release heading that is neither dated nor versioned", () => {
    expect(() =>
      parsePublicChangelog(document("## Summer", "", "### Added", "", "- A thing.", "")),
    ).toThrow(/is not a release heading/);
  });

  it("refuses a second section for the same day", () => {
    expect(() =>
      parsePublicChangelog(
        document(
          "## 2026-08-12",
          "",
          "### Added",
          "",
          "- One.",
          "",
          "## 2026-08-12",
          "",
          "### Fixed",
          "",
          "- Two.",
          "",
        ),
      ),
    ).toThrow(/a second section for 2026-08-12/);
  });

  it("refuses an empty bullet", () => {
    expect(() =>
      parsePublicChangelog(document("## 2026-08-12", "", "### Added", "", "- ", "")),
    ).toThrow(/an empty bullet/);
  });

  it("reports every problem in the document at once", () => {
    try {
      parsePublicChangelog(document("- Orphan.", "", "## Summer", "", "### Nope", ""));
      expect.unreachable("the document is malformed and the parse must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicChangelogParseError);
      expect((error as PublicChangelogParseError).problems.length).toBeGreaterThan(2);
    }
  });

  it("accepts every category the assembler can write", () => {
    // The assembler folds under exactly these headings. A category it writes and this parser did not
    // know would drop a shipped change out of the published changelog without failing anything.
    const sections = CHANGELOG_CATEGORIES.flatMap((category) => [
      `### ${category}`,
      "",
      `- An entry in ${category}.`,
      "",
    ]);
    const entries = parsePublicChangelog(document("## 2026-08-12", "", ...sections));
    expect(entries.map((entry) => entry.category)).toEqual([...CHANGELOG_CATEGORIES]);
  });
});

describe("buildPublicChangelogArtifact", () => {
  it("wraps the parsed entries in the published contract", () => {
    const artifact = buildPublicChangelogArtifact(
      document("## 2026-08-12", "", "### Added", "", "- A change.", ""),
      "2026-08-12T09:00:00.000Z",
    );
    expect(artifact).toEqual({
      schemaVersion: SCHEMA_VERSION,
      generatedAt: "2026-08-12T09:00:00.000Z",
      entries: [{ date: "2026-08-12", version: null, category: "Added", text: "A change." }],
    });
  });

  it("produces an empty artifact for a document with nothing published yet", () => {
    const artifact = buildPublicChangelogArtifact(document(), "2026-08-12T09:00:00.000Z");
    expect(artifact.entries).toEqual([]);
  });
});

describe("groupIntoReleases", () => {
  it("groups by date and orders categories for display", () => {
    const artifact = buildPublicChangelogArtifact(
      document(
        "## 2026-08-12",
        "",
        "### Fixed",
        "",
        "- A fix.",
        "",
        "### Added",
        "",
        "- A feature.",
        "",
        "## 2026-08-01",
        "",
        "### Added",
        "",
        "- An earlier feature.",
        "",
      ),
      "2026-08-12T09:00:00.000Z",
    );
    const releases = groupIntoReleases(artifact);
    expect(releases.map((release) => release.date)).toEqual(["2026-08-12", "2026-08-01"]);
    // Added leads Fixed in the Keep-a-Changelog order regardless of how the document holds them.
    expect(releases[0]?.categories.map((group) => group.category)).toEqual(["Added", "Fixed"]);
    expect(releases[1]?.categories[0]?.entries).toHaveLength(1);
  });

  it("returns nothing for an empty artifact", () => {
    expect(groupIntoReleases({ schemaVersion: SCHEMA_VERSION, generatedAt: "", entries: [] })).toEqual(
      [],
    );
  });
});
