// `vp run worktrees` — print the active-work registry: every stream still in flight, merged with the
// hand-authored notes in docs/active-work/, plus the touch-overlap surface. Read-only; nothing is
// written or committed, so the registry can never become a contended file itself.
//
// Being read-only is not what makes it accurate. Two things do, and both are here because their
// absence made this tool report the opposite of the truth: a stream is in flight only until its
// branch lands, whatever files it left behind (tooling/branch-landing), and a note the parser cannot
// read is named rather than dropped.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  baselineRef,
  landedBranchesIn,
  listWorktrees,
  resolveBranchRef,
} from "../branch-landing/index.mjs";
import { planRetirement } from "../retire-note/dependents.mjs";
import { branchFromNotePath, findOverlaps, isUnreadable, parseNote } from "./parse-note.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ACTIVE_DIR = join(ROOT, "docs/active-work");
const FRAGMENT_DIR = join(ROOT, "status.d");
const RESERVED = new Set(["_sections.md", "README.md"]);
const baseline = baselineRef(ROOT);

// Read once, and only if a dead note is found — the healthy run, which is most of them, never touches
// status.d/ at all.
let fragmentCache = null;
function statusFragments() {
  if (fragmentCache !== null) return fragmentCache;
  fragmentCache = existsSync(FRAGMENT_DIR)
    ? readdirSync(FRAGMENT_DIR)
        .filter((name) => name.endsWith(".md") && !RESERVED.has(name))
        .map((name) => ({
          path: `status.d/${name}`,
          text: readFileSync(join(FRAGMENT_DIR, name), "utf8"),
        }))
    : [];
  return fragmentCache;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

// Drift from the trunk, or null when the branch cannot be resolved here at all.
//
// Null is not zero. A stream on another machine has no local ref, and answering "+0/-0" for it reads
// as perfectly in sync — the one state that needs no action — for a branch that may be hundreds of
// commits behind. The measurement is against `origin/main` for the same reason the landing search is:
// a local `main` in a long-lived clone answers for a trunk nobody is on.
function divergence(branch) {
  const ref = resolveBranchRef(branch, ROOT);
  if (ref === null) return null;
  try {
    const count = (range) => Number.parseInt(git(["rev-list", "--count", range]).trim(), 10);
    return { ahead: count(`${baseline}..${ref}`), behind: count(`${ref}..${baseline}`) };
  } catch {
    return null;
  }
}

// Notes are named after the branch they describe, so a branch with a slash (`claude/foo`) is a note
// in a subdirectory (`docs/active-work/claude/foo.md`). Walking the tree rather than one flat listing
// is what makes those notes visible at all — a non-recursive read sees only the top level and reports
// every namespaced stream as noteless.
function loadNotes(dir = ACTIVE_DIR) {
  if (!existsSync(dir)) return [];
  const notes = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      notes.push(...loadNotes(full));
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
      const path = relative(ROOT, full).replace(/\\/g, "/");
      notes.push({ path, ...parseNote(readFileSync(full, "utf8"), branchFromNotePath(path)) });
    }
  }
  return notes;
}

function isAgent(path) {
  return path.replace(/\\/g, "/").includes("/.claude/worktrees/");
}

const worktrees = listWorktrees(ROOT).filter((w) => w.branch && w.branch !== "main" && !w.detached);
const notes = loadNotes();
const readable = notes.filter((note) => !isUnreadable(note));

// One landing question, asked over every branch either half of the registry knows about.
const { landed, unresolved } = landedBranchesIn({
  branches: [...new Set([...worktrees.map((w) => w.branch), ...notes.map((n) => n.branch)])],
  cwd: ROOT,
});

// A stream is in flight if a workspace for it exists here, or its branch has not landed yet.
//
// Either alone is too narrow. Only-worktrees hides every stream on another machine, and this
// checkout sees none of theirs — spanning checkouts is the whole point of the registry. Only-unlanded
// hides a workspace whose branch landed and that somebody is still committing into, which is exactly
// the case where a collision warning is worth most.
const hasWorktree = new Set(worktrees.map((worktree) => worktree.branch));
const isLive = (branch) => hasWorktree.has(branch) || !landed.has(branch);

const liveNotes = readable.filter((note) => isLive(note.branch));
const noteByBranch = new Map(liveNotes.map((note) => [note.branch, note]));

const streams = [
  ...worktrees.map((worktree) => ({
    branch: worktree.branch,
    here: true,
    agent: isAgent(worktree.path),
  })),
  ...liveNotes
    .filter((note) => !hasWorktree.has(note.branch))
    .map((note) => ({ branch: note.branch, here: false, agent: false })),
].sort((left, right) => left.branch.localeCompare(right.branch));

console.log("Streams in flight (branch · area · status · ahead/behind main):\n");
if (streams.length === 0) console.log("  none");
for (const stream of streams) {
  const note = noteByBranch.get(stream.branch);
  const drift = divergence(stream.branch);
  const position = drift === null ? "drift unknown" : `+${drift.ahead}/-${drift.behind}`;
  const behind =
    drift !== null && drift.behind > 20 ? `  [behind ${drift.behind} — sync main]` : "";
  const where = stream.here ? (stream.agent ? " · agent worktree" : "") : " · not checked out here";
  const scope = note
    ? `${note.area || "?"} · ${note.status || "?"}`
    : `(no note — add docs/active-work/${stream.branch}.md)`;
  console.log(`  ${stream.branch}  —  ${scope}${where}  ·  ${position}${behind}`);
}

const overlaps = findOverlaps(liveNotes);
if (overlaps.length > 0) {
  console.log("\nDeclared touch-overlaps (coordinate before editing):");
  for (const { path, branches } of overlaps) console.log(`  ${path}  ←  ${branches.join(", ")}`);
} else {
  console.log("\nNo declared touch-overlaps among streams in flight.");
}

// Both failures below leave the registry looking healthy while it is not: a landed stream's note
// keeps warning about collisions that cannot happen, and an unreadable note declares a touch list
// the parser never sees. Neither is inferable from the sections above, so each is named here.
//
// A dead note is named together with the status fragments pointing at it and the one command that
// removes both. Naming the note alone is what this used to do, and it taught the wrong lesson: the
// deletion looks like one file, the fragment pointer is then dangling, and `pnpm run lint:status`
// fails afterwards with "active-work points at a missing file". The tool already knows which notes
// are dead; reading the pointers costs one directory scan, so the discovery and the remedy arrive
// together rather than one session apart.
const stale = notes.filter((note) => !isLive(note.branch));
if (stale.length > 0) {
  console.log(`\n${stale.length} note(s) for branches that have landed — retire them:`);
  for (const note of stale) {
    const { dependents } = planRetirement({ notePath: note.path, fragments: statusFragments() });
    const pointers =
      dependents.length === 0
        ? ""
        : `\n      also clears the active-work pointer in ${dependents.map((d) => d.path).join(", ")}`;
    console.log(`  ${note.path}\n      vp run retire-note ${note.branch}${pointers}`);
  }
}

// A note whose name matches no ref at all, local or remote. Either it is misnamed — the path must
// mirror the branch exactly, slashes included, or nothing can look the branch up — or the branch was
// never pushed. Neither is answerable from here, so both are shown rather than guessed at; the
// stream stays listed as in flight in the meantime, because "cannot tell" must not read as "gone".
const unresolvedNotes = notes.filter((note) => unresolved.includes(note.branch));
if (unresolvedNotes.length > 0) {
  console.log(`\n${unresolvedNotes.length} note(s) naming a branch that resolves to no ref:`);
  for (const note of unresolvedNotes) console.log(`  ${note.path}  (branch: ${note.branch})`);
}

// Only for streams still running: a finished stream's note is deleted, not repaired.
const unreadable = notes.filter(
  (note) => isUnreadable(note) && isLive(note.branch) && !unresolved.includes(note.branch),
);
if (unreadable.length > 0) {
  console.log(
    `\n${unreadable.length} note(s) with no frontmatter block — invisible to this registry, so they` +
      " warn nobody. Add one (docs/active-work/README.md), or delete the note:",
  );
  for (const note of unreadable) console.log(`  ${note.path}`);
}
