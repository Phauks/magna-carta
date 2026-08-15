import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The fragment assembler that WRITES the document this package reads. Imported across the workspace
// boundary on purpose: the two sides agree on a set of category headings, and the only way that
// agreement stays true is a test that fails when one side changes alone.
import { CATEGORY_ORDER } from "../../../tooling/doc-fragments/changelog.mjs";
// The ledger renderer that PRODUCES the roadmap document this package reads — imported across the
// workspace boundary for the same reason as the assembler above. The document is not written to
// disk (there are no users yet, so the public rendering has no audience), so the corpus test renders
// it in memory from the real ledger. That keeps the end-to-end guarantee the on-disk version gave —
// every capability in this repository survives the round trip from ledger to artifact — without a
// committed file nobody reads.
import { loadAreas } from "../../../tooling/doc-fragments/build-register.mjs";
import { BANDS, renderPublicRoadmap } from "../../../tooling/doc-fragments/roadmap.mjs";
import { buildPublicChangelogArtifact } from "../src/public-changelog.ts";
import { buildPublicRoadmapArtifact } from "../src/public-roadmap.ts";
import { CHANGELOG_CATEGORIES, ROADMAP_BANDS } from "../src/schema.ts";

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

describe("the public roadmap this repository's ledger would render", () => {
  const markdown = renderPublicRoadmap(loadAreas(`${ROOT}/roadmap.d`));

  it("parses, so the ledger can never hold a state the artifact build would reject", () => {
    const artifact = buildPublicRoadmapArtifact(markdown, new Date().toISOString());
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.entries.length).toBeGreaterThan(0);
    for (const entry of artifact.entries) expect(ROADMAP_BANDS).toContain(entry.band);
  });

  it("states no date, which is the posture the document exists to hold", () => {
    expect(markdown).not.toMatch(/\b(19|20)\d{2}\b|\bQ[1-4]\b/);
  });

  it("shares one band vocabulary with the ledger renderer", () => {
    expect([...ROADMAP_BANDS]).toEqual(BANDS);
  });
});
