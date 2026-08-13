import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The fragment assembler that WRITES the document this package reads. Imported across the workspace
// boundary on purpose: the two sides agree on a set of category headings, and the only way that
// agreement stays true is a test that fails when one side changes alone.
import { CATEGORY_ORDER } from "../../../tooling/doc-fragments/changelog.mjs";
import { buildPublicChangelogArtifact } from "../src/public-changelog.ts";
import { CHANGELOG_CATEGORIES } from "../src/schema.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("the assembled public changelog in this repository", () => {
  it("parses, so the repository can never carry a document the artifact build would reject", () => {
    const markdown = readFileSync(`${ROOT}/docs/public-changelog.md`, "utf8");
    const artifact = buildPublicChangelogArtifact(markdown, new Date().toISOString());
    expect(artifact.schemaVersion).toBe(1);
    for (const entry of artifact.entries) {
      expect(CHANGELOG_CATEGORIES).toContain(entry.category);
    }
  });

  it("shares one category vocabulary with the fragment assembler", () => {
    expect([...CHANGELOG_CATEGORIES]).toEqual(CATEGORY_ORDER);
  });
});
