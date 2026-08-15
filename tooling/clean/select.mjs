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

// The most trunk commits one branch's landing search may examine. A branch that landed matches on
// its first candidate or very close to it, because the landing commit is the earliest trunk commit
// after the branch point that touches the branch's own files. The cap bounds the other case — a
// branch that never landed, where every candidate is examined and none of them matches.
export const MAX_LANDING_CANDIDATES = 25;

// Where a branch's content entered the trunk — the commit it landed in — or null when it never did.
//
// The durable question is "did this branch's content land", NOT "would merging this branch into the
// trunk's CURRENT tip change anything". Those two agree only at the instant of the merge. Afterwards
// the trunk moves on, and the moment it touches any file the branch also touched, re-merging the
// stale branch stops being a no-op — it would re-apply the branch's hunks over newer content, or
// conflict outright. The current-tip comparison then reports "not landed" for a branch that provably
// landed, and keeps reporting it forever. It decays precisely as a worktree ages, which is when
// there is most build output to reclaim.
//
// A landing is a fact about the past, so it is looked for in the past. `candidateCommits` are trunk
// commits from the branch point forward, oldest first; the branch landed at the first one that
// already subsumes it. That answer never expires, because the commit it names never moves.
//
// Subsumption at a commit is a merge comparison rather than an ancestry one because pull requests
// land here as SQUASH merges: the squashed commit is a new object, so a landed branch is never an
// ancestor of anything and ancestry reports it unlanded forever. Merging a branch into the commit
// that squashed it changes no file, whatever the commit graph looks like.
//
// `mergeResultTree` returns the merged tree's object id, or null when that merge conflicts — null
// can never equal a tree id, so a conflict reads as "not subsumed here" and the search moves on.
export function landingCommit({ candidateCommits, treeOf, mergeResultTree }) {
  for (const commit of candidateCommits.slice(0, MAX_LANDING_CANDIDATES)) {
    if (mergeResultTree(commit) === treeOf(commit)) return commit;
  }
  return null;
}

// Which of `candidateBranches` have already delivered their work into the baseline?
//
// A branch that has no commit the baseline lacks is excluded before anything else is asked. It has
// delivered nothing: it is a workspace someone cut off the trunk and is about to build in, and its
// build output is live. Every content test would call it landed, because a branch with no commits of
// its own trivially adds nothing to any tree. A branch sitting exactly on the baseline commit is the
// narrowest case of this, and the only one an equality check catches — a workspace cut a week ago
// and never committed in is just as empty and is not on the baseline commit any more.
//
// That guard is also why an ancestry test — "is the branch's tip reachable from the baseline?" — is
// not one of the tests here. In a squash-merging repository the two are the SAME question asked with
// opposite answers: a delivered branch is never an ancestor of the trunk, so every branch ancestry
// reports is one with no commits of its own, which is exactly the live workspace the guard protects.
// Ancestry looks like a second, independent confirmation of a landing and is in fact a rename of the
// condition that means the opposite; the branch the two disagree about is a live one whose build
// directory this tool deletes.
//
// `landingCommitOf` answers the durable question (see landingCommit above); a branch is landed when
// it names a commit.
export function landedBranches({ candidateBranches, contributesNoCommit, landingCommitOf }) {
  const landed = new Set();
  for (const branch of candidateBranches) {
    if (contributesNoCommit(branch)) continue;
    if (landingCommitOf(branch) !== null) landed.add(branch);
  }
  return landed;
}
