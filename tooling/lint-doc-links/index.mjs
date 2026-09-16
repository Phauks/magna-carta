/*
 * The dead-link gate. Every relative link in the documentation must point at something that is
 * really there.
 *
 * WHY IT EXISTS. This repository's central discipline is one home per fact: nothing is written
 * twice, and everything that needs a fact somewhere else links to it instead of restating it. That
 * makes a link load-bearing in a way it is not in a repository that duplicates freely — a rotted
 * link here is not an inconvenience, it is a lost fact, because the sentence that would have
 * repeated it was deliberately never written. Links into source are the same fact by the same
 * argument: a convention that says "the worked implementation is tooling/branch-landing/" and points
 * at a directory that has since moved leaves the reader with a rule and no way to see it obeyed.
 * Until this gate existed a broken link was found only by whoever followed it.
 *
 * WHAT IT CHECKS. For every tracked Markdown file under docs/, at the repository root, and every
 * per-area CLAUDE.md: each relative link resolves to a path that really exists, and where the link
 * carries a `#anchor` into a Markdown file, that file has a heading whose GitHub slug matches. The
 * anchor half is the part that takes care — rules.mjs holds the slug rules and the reasoning behind
 * them, because a slugger that is nearly right reports good links as broken and gets a gate switched
 * off. On the tree it landed against: about 1,700 relative links across roughly 1,050 documents.
 *
 * WHAT IT DOES NOT CHECK, stated plainly:
 *
 *   - EXTERNAL `http(s)` LINKS ARE OUT OF SCOPE, on purpose and permanently. A gate that reaches the
 *     network fails when the network does, fails differently for every runner, and turns an
 *     unrelated outage into a red build. A link rotting off-site is a real problem; it is not this
 *     gate's problem.
 *   - Whether the link points at the RIGHT thing. A link to a file that exists but no longer says
 *     what the sentence claims reads as sound here. Review answers that one.
 *   - Markdown outside the three sets above — package READMEs, the fragment directories, the agent
 *     and skill files. The three sets are the documentation a reader navigates; widening the scan is
 *     a one-line change to SCOPE when that stops being true.
 *   - The rest of the exclusions — reference-style uses, raw HTML links, root-absolute paths, line
 *     anchors into source — are rules.mjs's, and its header says why for each.
 *
 * THE BASELINE, AND WHY THERE IS ONE. Measured before it was chosen. The first pass reported 102
 * broken links; sixty-five of those turned out to be the gate's own fault — prose that is moved and
 * re-rendered was being resolved from one home when it has several (see below), and another stream's
 * uncommitted directory was being read as a missing one. What was left is 37 real ones, and exactly
 * one of them could be fixed here: a user guide pointing at `#opening-the-matter` in a document whose
 * heading is "Completing the Intake, and Opening the Matter". That link is repaired in this change.
 *
 * The other 36 could not be, and the reason is the same reason a ratchet is the right instrument:
 * they are in documents a branch must not edit. Three are in `CHANGELOG.md` and two in
 * `docs/Decision-Log.md`, which are assembled on main and never hand-edited; thirty are in numbered
 * decision records, where the links were correct in the pending fragment and climbed one level too
 * many when the assembler promoted the file — the repair belongs in the assembler, as a link rewrite
 * on promotion, and the records themselves are point-in-time. One names a design document that was
 * deleted rather than moved, so there is nothing to repoint at.
 *
 * So baseline.json holds those 36, each with its reason, and may only ever SHRINK: an entry that no
 * longer matches a real finding fails the gate, so a repaired link cannot leave its exemption behind.
 * Nothing belongs in it that the same change could have fixed.
 *
 * Run: `pnpm run lint:doc-links`. Pure text plus `git ls-files`; no install, no build, no network.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SELF_TEST, checkLink, collectAnchors, extractLinks, slugify } from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = path.join(ROOT, "tooling", "lint-doc-links", "baseline.json");

/** The documentation a reader navigates: the docs tree, the root files, and every area's CLAUDE.md. */
export const SCOPE = /^(docs\/.*\.md|[^/]+\.md|(?:.*\/)?CLAUDE\.md)$/;

const gitLines = (args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/*
 * What the tree can answer. A path counts as real when the repository TRACKS it, or — failing that —
 * when it is on disk right now.
 *
 * Tracked first, because that is the deterministic half: it is the same answer on every machine, and
 * it is the answer a reader following the link on GitHub gets. The working-tree fallback exists
 * because several streams share a worktree here, and a link into a directory a concurrent stream has
 * written but not yet committed is not rot — reporting it as rot would make the gate fire loudest
 * exactly when two people are working. The cost is the opposite mistake: a link into something that
 * exists only after a build passes locally and fails on a clean checkout. That is the better way
 * round, because a fresh worktree's first gate run is a clean checkout and catches it.
 */
export function indexTree(trackedPaths, onDisk = () => null) {
  const files = new Set(trackedPaths);
  const directories = new Set(["", "."]);
  for (const file of trackedPaths) {
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      directories.add(parts.slice(0, depth).join("/"));
    }
  }
  return {
    kindOf(target) {
      const clean = target.replace(/\/+$/, "");
      if (files.has(clean)) return "file";
      if (directories.has(clean)) return "directory";
      return onDisk(clean);
    },
  };
}

/*
 * A DECISION HAS MORE THAN ONE HOME, and its links are read from every one of them.
 *
 * A pending fragment at `docs/decisions/pending/<slug>.md` is promoted by the assembler to
 * `docs/decisions/<number>-<slug>.md`, and its body is then rendered verbatim into the register at
 * `docs/Decision-Log.md`. Three depths, one piece of prose, and the corpus was authored against all
 * three: roughly two thirds of the pending fragments write `../specs/<design>.md` for the destination,
 * the rest write `../../specs/<design>.md` for where the file sits today, and older records write a
 * bare `specs/<design>.md` for the register. Each spelling is correct somewhere and none is correct
 * everywhere, so a link that resolves at any home the file actually has is not rot. Which spelling the
 * corpus should settle on is a convention question, and rewriting links at assembly time is the
 * assembler's job; a lint that picked a side would report the other two thirds as broken.
 *
 * Insisting on one home cost twenty-six false positives, then ten of the opposite kind. What survives
 * this — a link correct at none of its homes — is real, and most of it is promotion rot: a fragment
 * authored correctly for `pending/` whose links climbed one level too many the moment it was numbered.
 */
export const PENDING_DECISIONS = "docs/decisions/pending/";
export const DECISION_REGISTER = "docs/Decision-Log.md";
const DECISION_RECORD = /^docs\/decisions\/\d+-[^/]+\.md$/;

/** Every path a document's prose is read from — one, or several for prose that is moved and re-rendered. */
export function homesOf(file) {
  if (file.startsWith(PENDING_DECISIONS)) {
    return [file, `docs/decisions/${path.posix.basename(file)}`, DECISION_REGISTER];
  }
  if (DECISION_RECORD.test(file)) return [file, DECISION_REGISTER];
  return [file];
}

/** The paths a link written in `fromFile` could mean — one entry, or several for prose that moves. */
export function resolveCandidates(fromFile, target) {
  const homes = homesOf(fromFile);
  if (target === "") return [fromFile];
  const resolved = [];
  for (const home of homes) {
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(home), target));
    if (joined === ".." || joined.startsWith("../")) continue;
    const clean = joined.replace(/^\.\//, "");
    if (!resolved.includes(clean)) resolved.push(clean);
  }
  return resolved;
}

/** Every finding in one document, as `{ file, line, rule, detail, key }`. */
export function checkDocument({ file, markdown, tree, anchorsOf }) {
  const found = [];
  for (const link of extractLinks(markdown)) {
    const candidates = resolveCandidates(file, link.target);
    const anchorText = link.anchor === null ? "" : `#${link.anchor}`;
    const key = `${file} -> ${link.target}${anchorText}`;
    if (candidates.length === 0) {
      found.push({
        file,
        line: link.line,
        rule: "outside-repository",
        detail: `${link.target} climbs out of the repository — rewrite it relative to the repository root`,
        key,
      });
      continue;
    }
    // A file with two homes is sound at whichever of them resolves; the anchor is then checked
    // against that one. With one home this is simply the link.
    const resolved = candidates.find((one) => tree.kindOf(one) !== null) ?? candidates[0];
    const problem = checkLink({ path: resolved, anchor: link.anchor }, { ...tree, anchorsOf });
    if (problem !== null) found.push({ file, line: link.line, ...problem, key });
  }
  return found;
}

// The gate's own rules, checked against their fixtures on every invocation, so a rule that stops
// biting fails here as well as in the suite.
export function runSelfTest() {
  const failures = [];
  const compare = (name, found, wanted) => {
    if (JSON.stringify(found) !== JSON.stringify(wanted)) failures.push({ name, found, wanted });
  };
  for (const scenario of SELF_TEST) {
    if (scenario.links !== undefined) {
      compare(scenario.name, extractLinks(scenario.markdown), scenario.links);
    }
    if (scenario.anchors !== undefined) {
      compare(scenario.name, [...collectAnchors(scenario.markdown)], scenario.anchors);
    }
    if (scenario.link !== undefined) {
      const kinds = scenario.tree ?? {};
      const anchors = scenario.anchorsBy ?? {};
      const problem = checkLink(scenario.link, {
        kindOf: (target) => kinds[target] ?? null,
        anchorsOf: (target) => new Set(anchors[target] ?? []),
      });
      compare(scenario.name, problem === null ? null : problem.rule, scenario.expect);
    }
  }
  // The slugger is the part that produces false positives, so it is asserted directly as well.
  compare(
    "slugify keeps nothing but letters, numbers, hyphens and underscores",
    slugify("A/B: c!"),
    "ab-c",
  );
  return failures;
}

function readBaseline() {
  if (!existsSync(BASELINE)) return new Map();
  const parsed = JSON.parse(readFileSync(BASELINE, "utf8"));
  return new Map(Object.entries(parsed.broken ?? {}));
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-doc-links: the scan's own rules no longer do what they must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n    expected: ${JSON.stringify(failure.wanted)}\n    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const tracked = gitLines(["ls-files"]);
  const tree = indexTree(tracked, (target) => {
    try {
      return statSync(path.join(ROOT, target)).isDirectory() ? "directory" : "file";
    } catch {
      return null;
    }
  });
  const documents = tracked.filter((file) => SCOPE.test(file));

  // Vacuity guard: a scan that found no documents passes trivially, which is how a scope change
  // turns a gate into a no-op nobody notices.
  if (documents.length < 100) {
    console.error(
      `\nlint-doc-links: found only ${String(documents.length)} document(s) in scope — SCOPE or the` +
        " documentation layout has drifted. Repoint the scan rather than accepting the silence.\n",
    );
    process.exit(1);
  }

  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) {
      anchorCache.set(file, collectAnchors(readFileSync(path.join(ROOT, file), "utf8")));
    }
    return anchorCache.get(file);
  };

  const found = [];
  let links = 0;
  for (const file of documents) {
    const markdown = readFileSync(path.join(ROOT, file), "utf8");
    links += extractLinks(markdown).length;
    found.push(...checkDocument({ file, markdown, tree, anchorsOf }));
  }

  const baseline = readBaseline();
  const problems = found.filter((one) => !baseline.has(one.key));
  const stale = [...baseline.keys()].filter((key) => !found.some((one) => one.key === key));

  if (problems.length > 0 || stale.length > 0) {
    if (problems.length > 0) {
      console.error("\nLinks that point at nothing:\n");
      for (const one of problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.error(`  ${one.file}:${String(one.line)}  [${one.rule}]\n      ${one.detail}`);
      }
    }
    if (stale.length > 0) {
      console.error(
        "\nBaseline entries for links that are no longer broken — the ratchet only shrinks:\n",
      );
      for (const key of stale) {
        console.error(`  tooling/lint-doc-links/baseline.json  delete "${key}"`);
      }
    }
    console.error(
      `\n${String(problems.length + stale.length)} problem(s). Every link here is relative and is` +
        " checked against what the repository tracks; external http(s) links are deliberately not" +
        " checked at all. Fix the link, or — only when the target genuinely cannot be repointed in" +
        " this change — record it in tooling/lint-doc-links/baseline.json with a reason.",
    );
    process.exit(1);
  }

  const exempt = baseline.size === 0 ? "" : ` ${String(baseline.size)} baselined.`;
  console.log(
    `Documentation links sound: ${String(links)} relative link(s) across ${String(documents.length)} document(s) all resolve.${exempt}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
