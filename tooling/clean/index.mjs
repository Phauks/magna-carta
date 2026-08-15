// Reclaim regenerable build output and dangling Docker cache. Runs on demand (`vp run clean`) and
// automatically from the tracked post-merge hook when a branch lands in main
// (tooling/git-hooks/post-merge). Deletes ONLY git-ignored artifact directories (target/,
// .svelte-kit, .wrangler, .vite, dist, build, coverage) inside worktrees whose branch has landed in
// main — found by locating the trunk commit the branch's content entered, since pull requests here
// land as squash merges and a squashed branch is never an ancestor of anything — never the active
// worktree, never node_modules, never tracked source. The
// git check-ignore confirmation is the safety net: a directory that merely shares an artifact name
// but is tracked is never removed. Flags: --dry-run (report only), --all-worktrees (sweep every
// worktree except the current one — still git-ignored dirs only).
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  eligibleWorktrees,
  isArtifactDir,
  landedBranches,
  landingCommit,
  normalizePath,
} from "./select.mjs";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const allWorktrees = flags.has("--all-worktrees");

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd }).toString();
}

function listWorktrees() {
  const worktrees = [];
  let current = null;
  for (const line of git(["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim(), branch: null, detached: false };
      worktrees.push(current);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim().replace("refs/heads/", "");
    } else if (line.trim() === "detached") {
      current.detached = true;
    }
  }
  return worktrees;
}

// The ref every "is this landed?" question is asked against. `origin/main` is what pull requests
// actually merge into; a local `main` in a long-lived clone drifts behind it and answers for a
// state nobody is on any more. Fall back to the local ref only when there is no remote-tracking one.
function baselineRef() {
  try {
    git(["rev-parse", "--verify", "--quiet", "origin/main"]);
    return "origin/main";
  } catch {
    return "main";
  }
}

// How many of a branch's changed paths are used to narrow the landing search. The landing commit
// touches all of them, so any one of them selects it; sampling keeps a branch that rewrote a
// thousand files from overflowing the argument list.
const LANDING_PATH_SAMPLE = 50;

function nonEmptyLines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The tree a merge of `branch` into `commit` would produce, or null when that merge conflicts (or
// the git build predates `merge-tree --write-tree`).
function mergeResultTree(commit, branch) {
  try {
    return git(["merge-tree", "--write-tree", commit, branch]).trim();
  } catch {
    return null;
  }
}

// Does the branch hold no commit the baseline lacks? True for a workspace nobody has committed in
// yet, however far behind the trunk it has drifted — the live-worktree guard in select.mjs.
function contributesNoCommitTo(baseline) {
  return (branch) => {
    try {
      git(["merge-base", "--is-ancestor", branch, baseline]);
      return true;
    } catch {
      return false;
    }
  };
}

// The trunk commits a branch could have landed in, oldest first, with the baseline itself checked
// before them.
//
// Narrowing to commits that touch files the branch itself changed is what keeps the search bounded.
// Unfiltered, a branch sitting sixty commits behind is sixty whole-tree merges — about twelve
// seconds here, per branch, on every merge to main. Narrowed, the list is normally a single commit:
// the squash that landed the branch. The baseline goes first so a branch that merged moments ago,
// which is what the post-merge hook mostly sees, costs one comparison.
function landingCandidatesAgainst(baseline, baselineCommit) {
  return (branch) => {
    let mergeBase;
    try {
      mergeBase = git(["merge-base", baseline, branch]).trim();
    } catch {
      return []; // no shared history: there is no trunk this branch could have landed into
    }
    const paths = nonEmptyLines(git(["diff", "--name-only", mergeBase, branch])).slice(
      0,
      LANDING_PATH_SAMPLE,
    );
    if (paths.length === 0) return [baselineCommit];
    const walked = nonEmptyLines(
      git(["rev-list", "--reverse", baseline, `^${mergeBase}`, "--", ...paths]),
    );
    return [baselineCommit, ...walked.filter((commit) => commit !== baselineCommit)];
  };
}

// Branches whose work is already in the baseline. Asking whether merging a branch into the trunk's
// current tip would change anything is only right on the day it merges; this asks where the branch's
// content entered the trunk, which stays answerable however far the trunk has moved on since.
function mergedBranches(candidateBranches) {
  const baseline = baselineRef();
  const baselineCommit = git(["rev-parse", baseline]).trim();
  const candidatesFor = landingCandidatesAgainst(baseline, baselineCommit);
  return landedBranches({
    candidateBranches,
    contributesNoCommit: contributesNoCommitTo(baseline),
    landingCommitOf: (branch) =>
      landingCommit({
        candidateCommits: candidatesFor(branch),
        treeOf: (commit) => git(["rev-parse", `${commit}^{tree}`]).trim(),
        mergeResultTree: (commit) => mergeResultTree(commit, branch),
      }),
  });
}

// True when `path` is git-ignored. check-ignore is run with cwd inside the target worktree so the
// query resolves against that worktree's ignore rules, not the caller's.
function isIgnored(path, cwd) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd });
    return true;
  } catch {
    return false;
  }
}

// Collect git-ignored artifact directories under `root`, without descending into node_modules,
// .git, or a directory already matched (no need to walk inside target/). Returns absolute paths.
function findArtifactDirs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (isArtifactDir(entry.name) && isIgnored(full, root)) {
        found.push(full);
        continue;
      }
      walk(full);
    }
  };
  walk(root);
  return found;
}

function directorySize(path) {
  let total = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          total += statSync(full).size;
        } catch {
          // A temp file vanishing mid-walk is fine; count it as zero.
        }
      }
    }
  };
  try {
    walk(path);
  } catch {
    // An unreadable directory contributes zero.
  }
  return total;
}

// Human-readable size. Falls back to MiB below 1 GiB so small artifacts do not all read as
// "0.00 GiB" — the report is the cleaner's primary output.
function formatBytes(bytes) {
  const gibibyte = 1024 ** 3;
  return bytes >= gibibyte
    ? `${(bytes / gibibyte).toFixed(2)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function dockerPrune() {
  const lines = [];
  for (const args of [
    ["builder", "prune", "-f"],
    ["image", "prune", "-f"],
  ]) {
    try {
      const output = execFileSync("docker", args).toString();
      const match = output.match(/Total reclaimed space: .*/);
      lines.push(match ? `  ${match[0]}` : "  nothing to reclaim");
    } catch (error) {
      lines.push(
        error.code === "ENOENT"
          ? "  docker not installed — skipped"
          : "  docker unavailable — skipped",
      );
      break;
    }
  }
  return lines.join("\n");
}

const currentPath = normalizePath(git(["rev-parse", "--show-toplevel"]).trim());
const worktrees = listWorktrees();
const targets = eligibleWorktrees({
  worktrees,
  currentPath,
  mergedBranches: mergedBranches(
    worktrees.filter((worktree) => worktree.branch && !worktree.detached).map((w) => w.branch),
  ),
  allWorktrees,
});

console.log(dryRun ? "clean (dry-run — nothing will be deleted)\n" : "clean\n");
console.log(
  `Artifact sweep — ${targets.length} worktree(s) (${allWorktrees ? "all except current" : "landed in main"}):`,
);

// A sweep that selects nothing reads identically to a sweep that had nothing to do. Say which it
// was, so an operator watching disk fill is not reassured by a report about work it declined.
const skipped =
  eligibleWorktrees({ worktrees, currentPath, mergedBranches: new Set(), allWorktrees: true })
    .length - targets.length;
if (!allWorktrees && targets.length === 0 && skipped > 0) {
  console.log(
    `  none selected — ${skipped} other worktree(s) hold branches still open against main.`,
  );
  console.log("  --all-worktrees sweeps them too (git-ignored build output only).");
}

let reclaimed = 0;
for (const worktree of targets) {
  const dirs = findArtifactDirs(worktree.path);
  if (dirs.length === 0) {
    console.log(`  ${worktree.branch}: clean`);
    continue;
  }
  for (const dir of dirs) {
    const size = directorySize(dir);
    reclaimed += size;
    console.log(`  ${dryRun ? "would remove" : "removing"} ${dir}  (${formatBytes(size)})`);
    if (!dryRun) rmSync(dir, { recursive: true, force: true });
  }
}
console.log(
  `  ${dryRun ? "would reclaim" : "reclaimed"} ${formatBytes(reclaimed)} of build artifacts\n`,
);

console.log("Docker cache prune:");
console.log(dryRun ? "  skipped in dry-run" : dockerPrune());
