// Reclaim regenerable build output and dangling Docker cache. Runs on demand (`vp run clean`) and
// automatically from the tracked post-merge hook when a branch lands in main
// (tooling/git-hooks/post-merge). Deletes ONLY git-ignored artifact directories (target/,
// .svelte-kit, .wrangler, .vite, dist, build, coverage) inside worktrees whose branch is merged
// into main — never the active worktree, never node_modules, never tracked source. The
// git check-ignore confirmation is the safety net: a directory that merely shares an artifact name
// but is tracked is never removed. Flags: --dry-run (report only), --all-worktrees (sweep every
// worktree except the current one — still git-ignored dirs only).
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eligibleWorktrees, isArtifactDir, normalizePath } from "./select.mjs";

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

function mergedBranches() {
  const branches = new Set();
  const output = git(["branch", "--merged", "main", "--format=%(refname:short)"]);
  for (const line of output.split("\n")) {
    const name = line.trim();
    if (name) branches.add(name);
  }
  return branches;
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

function gibibytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function dockerPrune() {
  let output = "";
  try {
    output += execFileSync("docker", ["builder", "prune", "-f"]).toString();
    output += execFileSync("docker", ["image", "prune", "-f"]).toString();
  } catch (error) {
    return error.code === "ENOENT"
      ? "  docker not installed — skipped"
      : "  docker unavailable — skipped";
  }
  const totals = output.match(/Total reclaimed space: .*/g) || [];
  return totals.length > 0 ? totals.map((line) => `  ${line}`).join("\n") : "  nothing to reclaim";
}

const currentPath = normalizePath(git(["rev-parse", "--show-toplevel"]).trim());
const targets = eligibleWorktrees({
  worktrees: listWorktrees(),
  currentPath,
  mergedBranches: mergedBranches(),
  allWorktrees,
});

console.log(dryRun ? "clean (dry-run — nothing will be deleted)\n" : "clean\n");
console.log(
  `Artifact sweep — ${targets.length} worktree(s) (${allWorktrees ? "all except current" : "merged into main"}):`,
);

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
    console.log(`  ${dryRun ? "would remove" : "removing"} ${dir}  (${gibibytes(size)})`);
    if (!dryRun) rmSync(dir, { recursive: true, force: true });
  }
}
console.log(
  `  ${dryRun ? "would reclaim" : "reclaimed"} ${gibibytes(reclaimed)} of build artifacts\n`,
);

console.log("Docker cache prune:");
console.log(dryRun ? "  skipped in dry-run" : dockerPrune());
