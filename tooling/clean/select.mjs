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

// "Has this branch already delivered its work into the trunk?" lives in tooling/branch-landing —
// the active-work registry asks the same question, for the opposite purpose, and one wrong answer
// there either deletes a live workspace's build output or hides a real collision warning.

// The load-profile snapshotter's working copies, in the system temp directory. It reaps its own on
// close and on process exit (packages/fixtures/src/load-profile/snapshot.ts), so this sweep is only
// the backstop for a run that was killed outright — nothing else leaves one behind.
//
// The name is matched EXACTLY, not by prefix: `mkdtemp` appends six characters from a 62-character
// alphanumeric alphabet, and that shape is the snapshotter's working directory and nothing else. A
// bare prefix match would also select `mc-load-profile-cache-XXXXXX`, which is a fixture cache
// belonging to a test that reaps it itself — a different creator's directory, and not this sweep's to
// take. Everything outside this pattern is out of scope by construction.
const LOAD_PROFILE_WORKING_DIRECTORY = /^mc-load-profile-[A-Za-z0-9]{6}$/;

// How old a leftover must be before it is swept. A working copy in use by a run in flight is minutes
// old at most, so a day puts the cut far past any live run while still reclaiming the same week's
// leavings. The age bound is the whole safety argument for deleting by name: without it this sweep
// would race a concurrent session and delete the database it was measuring against.
export const STALE_WORKING_DIRECTORY_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Which temp entries are stale load-profile working copies.
 *
 * `entries` are `{ name, isDirectory, modifiedMs }` records read from the system temp directory. All
 * three conditions must hold — the exact name shape, a directory, and older than the age bound — so
 * this is a deliberate three-way conjunction rather than a filter that grew.
 */
export function staleWorkingDirectories({
  entries,
  now,
  maxAgeMs = STALE_WORKING_DIRECTORY_AGE_MS,
}) {
  return entries.filter(
    (entry) =>
      entry.isDirectory &&
      LOAD_PROFILE_WORKING_DIRECTORY.test(entry.name) &&
      now - entry.modifiedMs >= maxAgeMs,
  );
}
