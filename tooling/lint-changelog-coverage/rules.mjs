/*
 * The rules of the changelog-coverage gate, and why each line is drawn where it is. The runner is
 * index.mjs; everything here is a pure function over a list of paths, so the decision can be tested
 * without a repository and self-tested on every invocation.
 *
 * WHAT COUNTS AS "TOUCHES FIRST-PARTY SOURCE" is defined POSITIVELY — a root plus an extension —
 * rather than as a list of things to ignore. A negative list is wrong by default: every directory
 * added after it was written falls inside the gate whether or not anyone meant it to, and the first
 * few false failures teach people to reach for the escape hatch instead of the fragment. A positive
 * list is silent by default and has to be widened deliberately, which is the safer way for a gate to
 * be wrong.
 *
 * The roots are the four that ship to a firm: apps/, packages/, crates/, containers/. The extensions
 * are code: TypeScript and JavaScript in every spelling, Svelte, Rust, SQL and CSS. SQL is in because
 * a migration is the most consequential thing a merge can carry — `main` is production, so a schema
 * change reaches real data on the strength of whatever ran before it landed, and it is the last
 * change that should merge with no record of itself.
 *
 * WHAT IS THEREFORE OUT, and why each is right:
 *
 *   - docs/ and every Markdown file. Documentation is already a definition-of-done item in its own
 *     right; a changelog entry ABOUT a documentation edit is a second record of the same fact, which
 *     is the duplication this repository spends its effort avoiding.
 *   - tooling/ and .github/. These are the repository's own gates, assemblers and workflows. They are
 *     changelogged here by custom and that custom is worth keeping — but a gate that DEMANDED a
 *     fragment for every lint tweak would fire on the smallest, most frequent changes in the tree and
 *     would be routed around within a week. The gate holds the floor; the custom holds the ceiling.
 *   - The fragment directories themselves (changelog.d/, docs/decisions/pending/, status.d/,
 *     roadmap.d/) and the assembled trackers, which are output, not change.
 *   - Manifests, lockfiles and configuration — package.json, Cargo.toml, wrangler.jsonc, tsconfig.
 *     This is the real hole and it is named rather than hidden: a binding change or a dependency bump
 *     can reach production with nothing in the changelog. Those changes almost never arrive alone, so
 *     the gate usually still fires on the code beside them; when one does arrive alone, review is what
 *     catches it. Widening to configuration would mean every `pnpm install` lockfile drift demanding a
 *     fragment, which is the failure mode above.
 *
 * TESTS ARE IN, deliberately. A test is first-party source, the repository's own changelog is full of
 * entries about tests that were checking the wrong property, and tests are the largest single class of
 * "small change" there is — carving them out would leave the floor holding almost nothing. A change
 * that genuinely has nothing to say takes the exemption below, where it is written down.
 */

/** The four roots that ship to a firm. Nothing outside them is the product. */
export const SOURCE_ROOTS = ["apps/", "packages/", "crates/", "containers/"];

/** Code, as opposed to manifest, configuration or prose. */
export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".svelte",
  ".rs",
  ".sql",
  ".css",
];

/** Where a fragment lives, and where an exemption lives. */
export const FRAGMENT_PREFIX = "changelog.d/";
export const EXEMPTION_PREFIX = "changelog.d/exemptions/";

/*
 * Rust→WASM output is built into the source tree and is git-ignored, so it does not normally reach a
 * change set at all. It is named anyway: a generated file that slipped into one would otherwise demand
 * a changelog entry for something nobody wrote.
 */
const GENERATED = ["/src/pkg/", "/dist/", "/build/", "/target/", "/node_modules/"];

export function isShippingSource(file) {
  if (!SOURCE_ROOTS.some((root) => file.startsWith(root))) return false;
  if (GENERATED.some((mark) => file.includes(mark))) return false;
  return SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension));
}

/** A real changelog fragment — a `.md` directly in changelog.d/, which is what the assembler eats. */
export function isFragment(file) {
  return (
    file.startsWith(FRAGMENT_PREFIX) &&
    !file.startsWith(EXEMPTION_PREFIX) &&
    file.endsWith(".md") &&
    !file.endsWith("/README.md") &&
    !file.slice(FRAGMENT_PREFIX.length).includes("/")
  );
}

export function isExemption(file) {
  return file.startsWith(EXEMPTION_PREFIX) && file.endsWith(".md");
}

/*
 * THE ESCAPE HATCH, and the case for its shape.
 *
 * Some changes genuinely have nothing to tell anyone — a rename with no behaviour in it, a revert of
 * something that never reached main, a build fix for a break that existed for an hour. A gate with no
 * way out of those is a gate that gets a rubber-stamp fragment written to satisfy it, and a changelog
 * full of rubber stamps is worse than one with a gap, because it stops being read.
 *
 * So the hatch is a FILE: `changelog.d/exemptions/<slug>.md`, carrying one `reason:` key. Three
 * properties make that the right shape rather than a flag or an environment variable:
 *
 *   - It is IN THE DIFF. A reviewer sees the claim next to the change it excuses, in the same review,
 *     without knowing to go looking. A `--allow-missing` in a workflow file is invisible at exactly
 *     the moment it matters, and would apply to every change afterwards.
 *   - It has to be WRITTEN, in words, by the person claiming it. That is the whole of the review this
 *     gate is trying to force: not the fragment, the decision about whether there is one.
 *   - It only counts when it is part of THIS change. An exemption left behind on main grants nothing
 *     to anybody else, because the gate looks for it in the branch's own change set.
 *
 * It sits in a subdirectory on purpose: the assembler reads `.md` files directly inside changelog.d/,
 * so an exemption in a child directory can never be folded into the changelog as if it were an entry.
 */
export function readExemption(markdown) {
  const lines = markdown.split("\n");
  const end = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  if (end === -1) {
    return { reason: null, problem: "has no `---` frontmatter block" };
  }
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim() !== "reason") continue;
    const reason = line.slice(colon + 1).trim();
    return reason === ""
      ? { reason: null, problem: "has an empty `reason:` — the reason IS the review this forces" }
      : { reason, problem: null };
  }
  return { reason: null, problem: "has no `reason:` key" };
}

/** Split a change set into the three groups the decision is made from. */
export function classify(changedFiles) {
  return {
    source: changedFiles.filter(isShippingSource).toSorted(),
    fragments: changedFiles.filter(isFragment).toSorted(),
    exemptions: changedFiles.filter(isExemption).toSorted(),
  };
}

/**
 * The gate's decision.
 *
 * @param {object} input
 * @param {boolean} input.onTrunk  whether this run has no branch-shaped change to judge.
 * @param {readonly string[]} input.changed  every path the change touches.
 * @returns {{ outcome: string, source: string[], fragments: string[], exemptions: string[] }}
 */
export function decide({ onTrunk, changed }) {
  const groups = classify(changed);
  if (onTrunk) return { outcome: "trunk", ...groups };
  if (groups.source.length === 0) return { outcome: "no-source", ...groups };
  if (groups.fragments.length > 0) return { outcome: "covered", ...groups };
  if (groups.exemptions.length > 0) return { outcome: "exempt", ...groups };
  return { outcome: "missing", ...groups };
}

const source = "packages/billing/src/invoice.ts";
const fragment = "changelog.d/an-invoice-can-be-voided.md";
const exemption = "changelog.d/exemptions/a-rename-with-no-behaviour-in-it.md";

/*
 * The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
 * through the same entry point. Each is a change shape this repository actually produces.
 */
export const SELF_TEST = [
  {
    name: "source with a fragment beside it passes",
    onTrunk: false,
    changed: [source, fragment],
    expect: "covered",
  },
  {
    name: "source with no fragment is the whole point of the gate",
    onTrunk: false,
    changed: [source],
    expect: "missing",
  },
  {
    name: "a documentation-only change needs no fragment",
    onTrunk: false,
    changed: ["docs/conventions/dates.md", "CLAUDE.md", "docs/user/features/intake.md"],
    expect: "no-source",
  },
  {
    name: "a tooling-and-workflow change needs no fragment — the floor, not the ceiling",
    onTrunk: false,
    changed: [
      "tooling/lint-doc-links/index.mjs",
      "tooling/lint-doc-links/vitest.config.ts",
      ".github/workflows/assemble-docs.yml",
      "package.json",
    ],
    expect: "no-source",
  },
  {
    name: "a manifest or lockfile on its own is out of scope, and the header says so is a hole",
    onTrunk: false,
    changed: ["pnpm-lock.yaml", "apps/web/package.json", "apps/api-worker/wrangler.jsonc"],
    expect: "no-source",
  },
  {
    name: "a migration is source — the most consequential thing a merge carries",
    onTrunk: false,
    changed: ["packages/database/drizzle/control-plane/20260901T000000_a-column.sql"],
    expect: "missing",
  },
  {
    name: "a Rust crate is source, and so is a Svelte screen",
    onTrunk: false,
    changed: ["crates/pdf-core/src/lib.rs", "apps/web/src/routes/matters/+page.svelte"],
    expect: "missing",
  },
  {
    name: "a test is source: the repository changelogs its test work and this holds that line",
    onTrunk: false,
    changed: ["packages/billing/test/invoice.test.ts"],
    expect: "missing",
  },
  {
    name: "generated output inside a source root demands nothing",
    onTrunk: false,
    changed: ["packages/pdf/src/pkg/pdf_core.js", "apps/web/dist/bundle.js"],
    expect: "no-source",
  },
  {
    name: "an exemption in this change is the way out, and it is a file in the diff",
    onTrunk: false,
    changed: [source, exemption],
    expect: "exempt",
  },
  {
    name: "a fragment wins over an exemption when both are present",
    onTrunk: false,
    changed: [source, fragment, exemption],
    expect: "covered",
  },
  {
    name: "an exemption is not a fragment — the assembler must never fold one in",
    onTrunk: false,
    changed: [source, exemption],
    expect: "exempt",
    fragments: [],
  },
  {
    name: "changelog.d/README.md is not a fragment",
    onTrunk: false,
    changed: [source, "changelog.d/README.md"],
    expect: "missing",
  },
  {
    name: "on the trunk there is nothing to compare against, so the gate stands down",
    onTrunk: true,
    changed: [source],
    expect: "trunk",
  },
];
