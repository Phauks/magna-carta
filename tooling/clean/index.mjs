// Reclaim regenerable build output and dangling Docker cache. Runs on demand (`vp run clean`) and
// automatically from the tracked post-merge hook when a branch lands in main
// (tooling/git-hooks/post-merge). Deletes ONLY git-ignored artifact directories (target/,
// .svelte-kit, .wrangler, .vite, dist, build, coverage) inside worktrees whose branch has landed in
// main — by ancestry OR by content, since pull requests here land as squash merges and a squashed
// branch is never an ancestor — never the active worktree, never node_modules, never tracked source. The
// git check-ignore confirmation is the safety net: a directory that merely shares an artifact name
// but is tracked is never removed. Flags: --dry-run (report only), --all-worktrees (sweep every
// worktree except the current one — still git-ignored dirs only).
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eligibleWorktrees, isArtifactDir, landedBranches, normalizePath } from "./select.mjs";

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

// The tree a two-way merge of `branch` into the baseline would produce, or null when that merge
// conflicts (or the git build predates `merge-tree --write-tree`).
function mergeResultTreeAgainst(baseline) {
  return (branch) => {
    try {
      return git(["merge-tree", "--write-tree", baseline, branch]).trim();
    } catch {
      return null;
    }
  };
}

function ancestryMergedInto(baseline) {
  const branches = new Set();
  for (const line of git(["branch", "--merged", baseline, "--format=%(refname:short)"]).split(
    "\n",
  )) {
    const name = line.trim();
    if (name) branches.add(name);
  }
  return branches;
}

// Branches whose work is already in the baseline. The ancestry test (`git branch --merged`) alone
// reported nothing for months while landed worktrees accumulated gigabytes of build output, because
// pull requests land here as squash merges and a squashed branch is not an ancestor of anything.
function mergedBranches(candidateBranches) {
  const baseline = baselineRef();
  return landedBranches({
    candidateBranches,
    baselineCommit: git(["rev-parse", baseline]).trim(),
    baselineTree: git(["rev-parse", `${baseline}^{tree}`]).trim(),
    tipOf: (branch) => git(["rev-parse", branch]).trim(),
    ancestryMerged: ancestryMergedInto(baseline),
    mergeResultTree: mergeResultTreeAgainst(baseline),
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
  `Artifact sweep — ${targets.length} worktree(s) (${allWorktrees ? "all except current" : "merged into main"}):`,
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
