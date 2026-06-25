// Pure selection logic for the build-artifact cleaner (tooling/clean/index.mjs). Kept free of I/O
// so the rules that decide WHICH worktrees and directories may be deleted — the safety-critical
// part of the cleaner — are unit-testable in isolation.

// Regenerable build-output directory names. Every one is git-ignored (see .gitignore and the
// per-crate .gitignore for `target`); the orchestrator additionally confirms each candidate is
// ignored before deleting, so a tracked directory that happens to share one of these names is
// never removed.
export const ARTIFACT_DIRS = [
  "target",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "dist",
  "build",
  "coverage",
];

// Normalize a filesystem path for cross-worktree comparison: forward slashes, lowercase drive
// letter, no trailing slash. Git emits forward-slash paths; the OS may hand us backslashes —
// normalize both before comparing.
export function normalizePath(path) {
  let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

// Decide which worktrees may have their artifacts swept. Never the current worktree, never main,
// never a detached HEAD; otherwise included when allWorktrees is set, or when the branch is merged
// into main.
export function eligibleWorktrees({ worktrees, currentPath, mergedBranches, allWorktrees }) {
  const current = normalizePath(currentPath);
  return worktrees.filter((worktree) => {
    if (!worktree.branch || worktree.detached) return false;
    if (worktree.branch === "main") return false;
    if (normalizePath(worktree.path) === current) return false;
    return allWorktrees ? true : mergedBranches.has(worktree.branch);
  });
}

// Is `name` one of the regenerable artifact directory names?
export function isArtifactDir(name) {
  return ARTIFACT_DIRS.includes(name);
}
