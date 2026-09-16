import { describe, expect, it } from "vitest";
import {
  SCOPE,
  checkDocument,
  homesOf,
  indexTree,
  resolveCandidates,
  runSelfTest,
} from "./index.mjs";
import {
  SELF_TEST,
  blankFencedCode,
  collectAnchors,
  extractLinks,
  headingText,
  slugify,
} from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry points so a rule regression fails the suite as well as the gate, and adds the cases that are
// about the scan's own resolution and scope rather than about the text rules.

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      if (scenario.links !== undefined) {
        expect(extractLinks(scenario.markdown)).toEqual(scenario.links);
      }
      if (scenario.anchors !== undefined && scenario.markdown !== undefined) {
        expect([...collectAnchors(scenario.markdown)]).toEqual(scenario.anchors);
      }
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it scans", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("the slug, which is where a wrong answer becomes a false positive", () => {
  it("deletes punctuation rather than replacing it", () => {
    expect(slugify("Trust & costs")).toBe("trust--costs");
    expect(slugify("Dates, times, instants and zones")).toBe("dates-times-instants-and-zones");
    expect(slugify("What's next?")).toBe("whats-next");
  });

  it("keeps hyphens, underscores and digits, and lowercases the rest", () => {
    expect(slugify("Rule 0140 and amount_minor v2")).toBe("rule-0140-and-amount_minor-v2");
  });

  it("unwraps emphasis but leaves an underscored identifier alone", () => {
    expect(slugify(headingText("_Delivery model_"))).toBe("delivery-model");
    expect(slugify(headingText("**Golden** rules"))).toBe("golden-rules");
    expect(slugify(headingText("rate_e4 and amount_minor"))).toBe("rate_e4-and-amount_minor");
  });

  it("slugs a heading by its rendered text, not by a link target inside it", () => {
    expect(headingText("[`ROADMAP.md`](../../ROADMAP.md)")).toBe("`ROADMAP.md`");
    expect(slugify(headingText("[`ROADMAP.md`](../../ROADMAP.md)"))).toBe("roadmapmd");
  });
});

describe("fenced code, which holds the illustrations a gate must not follow", () => {
  it("blanks a fenced block without moving any line", () => {
    const blanked = blankFencedCode("a\n```\nb\n```\nc\n");
    expect(blanked.split("\n")).toHaveLength(6);
    expect(blanked.split("\n")[2]).toBe(" ");
    expect(blanked.split("\n")[4]).toBe("c");
  });

  it("does not let a tilde fence close a backtick fence", () => {
    expect(extractLinks("```\n~~~\n[x](gone.md)\n```\n[y](real.md)\n")).toEqual([
      { target: "real.md", anchor: null, line: 5 },
    ]);
  });
});

describe("what the tree can answer", () => {
  const tree = indexTree(["docs/conventions/dates.md", "tooling/lint-status.mjs"]);

  it("knows a tracked file, and every directory one implies", () => {
    expect(tree.kindOf("docs/conventions/dates.md")).toBe("file");
    expect(tree.kindOf("docs/conventions")).toBe("directory");
    expect(tree.kindOf("docs/conventions/")).toBe("directory");
    expect(tree.kindOf("docs")).toBe("directory");
  });

  it("knows nothing else, unless the working-tree fallback does", () => {
    expect(tree.kindOf("docs/gone.md")).toBeNull();
    const withDisk = indexTree([], (target) => (target === "tooling/new" ? "directory" : null));
    expect(withDisk.kindOf("tooling/new")).toBe("directory");
  });
});

describe("prose with more than one home", () => {
  it("reads an ordinary document from where it sits", () => {
    expect(homesOf("docs/conventions/dates.md")).toEqual(["docs/conventions/dates.md"]);
    expect(resolveCandidates("docs/conventions/dates.md", "../now.md")).toEqual(["docs/now.md"]);
  });

  it("reads a numbered decision record from its file and from the register", () => {
    expect(homesOf("docs/decisions/0140-per-firm-database-durable-object.md")).toEqual([
      "docs/decisions/0140-per-firm-database-durable-object.md",
      "docs/Decision-Log.md",
    ]);
  });

  it("reads a pending fragment from where it sits, where it lands, and the register", () => {
    expect(homesOf("docs/decisions/pending/a-thing-is-decided.md")).toEqual([
      "docs/decisions/pending/a-thing-is-decided.md",
      "docs/decisions/a-thing-is-decided.md",
      "docs/Decision-Log.md",
    ]);
  });

  it("accepts both spellings the pending directory actually uses", () => {
    // Written for the destination, and written for where the file sits today. Both are in the
    // corpus, and insisting on either one reported the other as rot.
    const destination = resolveCandidates(
      "docs/decisions/pending/a-thing.md",
      "../specs/a-design.md",
    );
    const here = resolveCandidates("docs/decisions/pending/a-thing.md", "../../specs/a-design.md");
    expect(destination).toContain("docs/specs/a-design.md");
    expect(here).toContain("docs/specs/a-design.md");
  });

  it("drops a candidate that climbs out of the repository instead of reporting it", () => {
    expect(resolveCandidates("docs/Decision-Log.md", "../../outside.md")).toEqual([]);
  });
});

describe("a document's findings", () => {
  const tree = indexTree(["docs/conventions/dates.md", "docs/user/features/intake-procedure.md"]);
  const anchorsOf = (file) =>
    file === "docs/user/features/intake-procedure.md"
      ? new Set(["completing-the-intake-and-opening-the-matter"])
      : new Set();

  it("reports a missing file at its line, with the path that does not exist", () => {
    const found = checkDocument({
      file: "docs/conventions/x.md",
      markdown: "a\n\n[y](../gone.md)\n",
      tree,
      anchorsOf,
    });
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
    expect(found[0].rule).toBe("missing-target");
    expect(found[0].detail).toContain("docs/gone.md");
  });

  it("reports a missing anchor and names the closest heading it found", () => {
    const found = checkDocument({
      file: "docs/user/features/intake.md",
      markdown: "[x](intake-procedure.md#opening-the-matter)\n",
      tree,
      anchorsOf,
    });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("missing-anchor");
  });

  it("says nothing about a sound link, an external one, or an anchor into its own headings", () => {
    const found = checkDocument({
      file: "docs/conventions/x.md",
      markdown: "# Golden rules\n\n[a](dates.md) [b](https://example.com) [c](#golden-rules)\n",
      tree: indexTree(["docs/conventions/dates.md", "docs/conventions/x.md"]),
      anchorsOf: (file) =>
        file === "docs/conventions/x.md" ? new Set(["golden-rules"]) : new Set(),
    });
    expect(found).toEqual([]);
  });

  it("gives a finding a key that does not move when the document does", () => {
    // The baseline is keyed by this, so a paragraph added above a broken link must not orphan its
    // entry — which is what a line-numbered key would do on the next edit.
    const [found] = checkDocument({
      file: "docs/a.md",
      markdown: "\n\n\n[x](gone.md#here)\n",
      tree,
      anchorsOf,
    });
    expect(found.key).toBe("docs/a.md -> gone.md#here");
  });
});

describe("the scope", () => {
  it("covers the docs tree, the root files and every area CLAUDE.md", () => {
    expect(SCOPE.test("docs/conventions/dates.md")).toBe(true);
    expect(SCOPE.test("CLAUDE.md")).toBe(true);
    expect(SCOPE.test("ROADMAP.md")).toBe(true);
    expect(SCOPE.test("packages/design-system/CLAUDE.md")).toBe(true);
    expect(SCOPE.test("apps/web/src/lib/CLAUDE.md")).toBe(true);
  });

  it("stops where the header says it stops", () => {
    expect(SCOPE.test("packages/design-system/README.md")).toBe(false);
    expect(SCOPE.test("changelog.d/a-thing-happened.md")).toBe(false);
    expect(SCOPE.test("docs/now.html")).toBe(false);
  });
});
