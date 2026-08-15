// The git side of "has this branch's work already reached the trunk?" — the plumbing that feeds the
// pure rule in ./select.mjs. Read-only: it runs merge-base, rev-list and merge-tree, and writes
// nothing. Consumers are the build-artifact cleaner (tooling/clean) and the active-work registry
// (tooling/worktrees).
import { execFileSync } from "node:child_process";
import { landedBranches, landingCommit } from "./select.mjs";

export { landedBranches, landingCommit, MAX_LANDING_CANDIDATES } from "./select.mjs";

// How many of a branch's changed paths are used to narrow the landing search. The landing commit
// touches all of them, so any one of them selects it; sampling keeps a branch that rewrote a
// thousand files from overflowing the argument list.
const LANDING_PATH_SAMPLE = 50;

function git(args, cwd) {
  return execFileSync("git", args, { cwd }).toString();
}

function nonEmptyLines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The ref every "is this landed?" question is asked against. `origin/main` is what pull requests
// actually merge into; a local `main` in a long-lived clone drifts behind it and answers for a
// state nobody is on any more. Fall back to the local ref only when there is no remote-tracking one.
export function baselineRef(cwd) {
  try {
    git(["rev-parse", "--verify", "--quiet", "origin/main"], cwd);
    return "origin/main";
  } catch {
    return "main";
  }
}

// Every git worktree attached to this checkout, with the branch each has checked out.
export function listWorktrees(cwd) {
  const worktrees = [];
  let current = null;
  for (const line of git(["worktree", "list", "--porcelain"], cwd).split("\n")) {
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

// The ref that actually resolves for a branch name, preferring the local one, or null when neither
// exists. The remote fallback is what makes a branch nobody has checked out here answerable at all:
// this repository cannot delete remote branches, so a landed branch's `origin/` ref outlives it by
// months while the local ref may never have existed on this machine.
export function resolveBranchRef(branch, cwd) {
  for (const ref of [branch, `origin/${branch}`]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref], cwd);
      return ref;
    } catch {
      // not this one; try the next
    }
  }
  return null;
}

// The tree a merge of `ref` into `commit` would produce, or null when that merge conflicts (or the
// git build predates `merge-tree --write-tree`).
function mergeResultTree(commit, ref, cwd) {
  try {
    return git(["merge-tree", "--write-tree", commit, ref], cwd).trim();
  } catch {
    return null;
  }
}

// The trunk commits a branch could have landed in, oldest first, with the baseline itself checked
// before them.
//
// Narrowing to commits that touch files the branch itself changed is what keeps the search bounded.
// Unfiltered, a branch sitting sixty commits behind is sixty whole-tree merges — about twelve
// seconds here, per branch. Narrowed, the list is normally a single commit: the squash that landed
// the branch. The baseline goes first so a branch that merged moments ago, which is what the
// post-merge hook mostly sees, costs one comparison.
function landingCandidates({ ref, baseline, baselineCommit, cwd }) {
  let mergeBase;
  try {
    mergeBase = git(["merge-base", baseline, ref], cwd).trim();
  } catch {
    return []; // no shared history: there is no trunk this branch could have landed into
  }
  const paths = nonEmptyLines(git(["diff", "--name-only", mergeBase, ref], cwd)).slice(
    0,
    LANDING_PATH_SAMPLE,
  );
  if (paths.length === 0) return [baselineCommit];
  const walked = nonEmptyLines(
    git(["rev-list", "--reverse", baseline, `^${mergeBase}`, "--", ...paths], cwd),
  );
  return [baselineCommit, ...walked.filter((commit) => commit !== baselineCommit)];
}

// Which of `branches` have already delivered their work into the trunk.
//
// A name that resolves to no ref at all is reported separately rather than folded into either
// answer: "this branch is finished" and "this branch does not exist" are different facts, and a
// caller that deletes things on the strength of the first must not be handed the second.
export function landedBranchesIn({ branches, cwd = process.cwd() }) {
  const baseline = baselineRef(cwd);
  const baselineCommit = git(["rev-parse", baseline], cwd).trim();

  const refs = new Map();
  const unresolved = [];
  for (const branch of branches) {
    const ref = resolveBranchRef(branch, cwd);
    if (ref === null) unresolved.push(branch);
    else refs.set(branch, ref);
  }

  const landed = landedBranches({
    candidateBranches: [...refs.keys()],
    contributesNoCommit: (branch) => {
      try {
        git(["merge-base", "--is-ancestor", refs.get(branch), baseline], cwd);
        return true;
      } catch {
        return false;
      }
    },
    landingCommitOf: (branch) =>
      landingCommit({
        candidateCommits: landingCandidates({
          ref: refs.get(branch),
          baseline,
          baselineCommit,
          cwd,
        }),
        treeOf: (commit) => git(["rev-parse", `${commit}^{tree}`], cwd).trim(),
        mergeResultTree: (commit) => mergeResultTree(commit, refs.get(branch), cwd),
      }),
  });

  return { landed, unresolved };
}
