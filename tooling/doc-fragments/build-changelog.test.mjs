import { describe, expect, it } from "vitest";
import { assembleChangelogs } from "./build-changelog.mjs";

const changelog = ["# Changelog", "", "## [Unreleased]", ""].join("\n");
const publicChangelog = ["# Product changelog", "", "Preamble.", ""].join("\n");

function assemble(fragments) {
  return assembleChangelogs({ changelog, publicChangelog, fragments, date: "2026-08-12" });
}

const internalFragment = {
  category: "Changed",
  audience: "internal",
  text: "The assembler now folds two documents.",
  publicText: null,
};
const publicFragment = {
  category: "Added",
  audience: "public",
  text: "The developer sentence, with the mechanism in it.",
  publicText: "**You can now see what changed.** In the reader's language.",
};

describe("assembleChangelogs", () => {
  it("folds every fragment into the developer changelog regardless of audience", () => {
    const out = assemble([internalFragment, publicFragment]);
    expect(out.changelog).toContain("- The assembler now folds two documents.");
    expect(out.changelog).toContain("- The developer sentence, with the mechanism in it.");
  });

  it("carries a public fragment's block into the public document in the SAME pass", () => {
    // The property this whole shape exists for: the customer prose lives only in the fragment, and
    // the caller deletes the fragment straight after this returns. A publish deferred to later would
    // have nothing left to publish.
    const out = assemble([publicFragment]);
    expect(out.publishedCount).toBe(1);
    expect(out.publicChangelog).toContain(
      "## 2026-08-12\n\n### Added\n\n- **You can now see what changed.** In the reader's language.",
    );
  });

  it("never leaks the developer sentence into the public document", () => {
    const out = assemble([publicFragment]);
    expect(out.publicChangelog).not.toContain("the mechanism in it");
  });

  it("leaves the public document untouched when nothing is published", () => {
    const out = assemble([internalFragment]);
    expect(out.publishedCount).toBe(0);
    expect(out.publicChangelog).toBe(publicChangelog);
  });

  it("keeps an internal fragment out of the public document entirely", () => {
    const out = assemble([internalFragment, publicFragment]);
    expect(out.publicChangelog).not.toContain("folds two documents");
  });

  it("groups a day's published entries under one dated heading by category", () => {
    const out = assemble([
      publicFragment,
      { ...publicFragment, category: "Fixed", publicText: "A fix you can see." },
      { ...publicFragment, publicText: "A second addition." },
    ]);
    expect(out.publishedCount).toBe(3);
    expect(out.publicChangelog.match(/## 2026-08-12/g)).toHaveLength(1);
    expect(out.publicChangelog).toContain("### Added");
    expect(out.publicChangelog).toContain("### Fixed");
    expect(out.publicChangelog).toContain("- A second addition.");
  });
});
