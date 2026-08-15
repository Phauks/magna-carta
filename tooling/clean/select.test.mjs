import { describe, expect, it } from "vitest";
import {
  eligibleWorktrees,
  isArtifactDir,
  landedBranches,
  landingCommit,
  MAX_LANDING_CANDIDATES,
  normalizePath,
} from "./select.mjs";

const WORKTREES = [
  { path: "C:/dev/magna-carta-worktrees/main-merge", branch: "main", detached: false },
  {
    path: "C:/dev/magna-carta-worktrees/feature-merged",
    branch: "feature-merged",
    detached: false,
  },
  { path: "C:/dev/magna-carta-worktrees/feature-open", branch: "feature-open", detached: false },
  { path: "C:/dev/magna-carta-worktrees/detached", branch: null, detached: true },
  { path: "C:/dev/magna-carta", branch: "current-branch", detached: false },
];

const base = {
  worktrees: WORKTREES,
  currentPath: "C:/dev/magna-carta",
  mergedBranches: new Set(["feature-merged"]),
};

describe("eligibleWorktrees", () => {
  it("sweeps merged, non-current, non-main worktrees only", () => {
    const got = eligibleWorktrees({ ...base, allWorktrees: false }).map((w) => w.branch);
    expect(got).toEqual(["feature-merged"]);
  });

  it("with allWorktrees includes open branches but never main, current, or detached", () => {
    const got = eligibleWorktrees({ ...base, allWorktrees: true }).map((w) => w.branch);
    expect(got).toEqual(["feature-merged", "feature-open"]);
  });

  it("matches the current worktree regardless of slash or drive-letter case", () => {
    const got = eligibleWorktrees({
      ...base,
      currentPath: "c:\\dev\\magna-carta",
      allWorktrees: true,
    }).map((w) => w.branch);
    expect(got).not.toContain("current-branch");
    expect(got).toEqual(["feature-merged", "feature-open"]);
  });
});

describe("normalizePath", () => {
  it("uses forward slashes, a lowercase drive letter, and no trailing slash", () => {
    expect(normalizePath("C:\\dev\\Foo\\")).toBe("c:/dev/Foo");
  });
});

describe("landingCommit", () => {
  // A trunk that squash-merged a branch at `squash`, then moved on twice, and each later commit
  // touched a file the branch also touched. Trunk commits are oldest first, as the caller supplies
  // them; the baseline (`newest`) is checked before the walk, so it leads the list.
  const trees = { newest: "t-newest", squash: "t-squash", after: "t-after" };
  const CANDIDATES = ["newest", "squash", "after"];

  // Merging the branch into the commit that squashed it changes nothing. Merging it into the
  // baseline two commits later would re-apply its hunks over newer content, so that tree differs —
  // which is the whole decay: the branch landed, and the current-tip comparison says it did not.
  const mergeResults = { newest: "t-merged-newest", squash: "t-squash", after: "t-merged-after" };

  const call = (results = mergeResults, candidateCommits = CANDIDATES) =>
    landingCommit({
      candidateCommits,
      treeOf: (commit) => trees[commit],
      mergeResultTree: (commit) => results[commit],
    });

  it("finds the commit a squash-merged branch landed in, long after the trunk moved past it", () => {
    expect(call()).toBe("squash");
  });

  it("still answers on the day of the merge, when the baseline is itself the landing commit", () => {
    expect(call({ ...mergeResults, newest: "t-newest" })).toBe("newest");
  });

  it("reports no landing for a branch whose work is still outstanding", () => {
    expect(call({ newest: "x", squash: "y", after: "z" })).toBe(null);
  });

  it("treats a conflicting merge as not landed there, and keeps looking", () => {
    // A conflict yields null. It must not be mistaken for a match, and it must not end the search:
    // the branch may still be subsumed by a later commit that resolved the same files.
    expect(call({ newest: null, squash: "t-squash", after: null })).toBe("squash");
  });

  it("stops after the candidate cap rather than merging against unbounded history", () => {
    const many = Array.from({ length: MAX_LANDING_CANDIDATES + 5 }, (_, index) => `c${index}`);
    const landsPastTheCap = { [`c${MAX_LANDING_CANDIDATES + 2}`]: "t-hit" };
    const found = landingCommit({
      candidateCommits: many,
      treeOf: (commit) => (commit in landsPastTheCap ? landsPastTheCap[commit] : `t-${commit}`),
      mergeResultTree: (commit) => landsPastTheCap[commit] ?? "t-other",
    });
    expect(found).toBe(null);
  });
});

describe("landedBranches", () => {
  // "squash-landed" reproduces how pull requests land here: commits of its own, and a trunk commit
  // that already subsumes them. "empty-workspace" is a worktree nobody has committed in — it has no
  // commit the baseline lacks, so every content test calls it landed and its build output is live.
  const landings = {
    "squash-landed": "abc123",
    "still-open": null,
    "empty-workspace": "abc123",
  };
  const call = (candidateBranches, empty = ["empty-workspace"]) =>
    landedBranches({
      candidateBranches,
      contributesNoCommit: (branch) => empty.includes(branch),
      landingCommitOf: (branch) => landings[branch],
    });

  it("counts a branch that landed by squash merge, which ancestry alone never sees", () => {
    expect([...call(["squash-landed", "still-open"])]).toEqual(["squash-landed"]);
  });

  it("never counts a workspace with no commits of its own — that is live, not finished", () => {
    expect(call(["empty-workspace"]).size).toBe(0);
  });

  it("keeps that guard for a stale workspace, not only one sitting on the baseline commit", () => {
    // The guard is about having delivered nothing, not about being up to date. A worktree cut a week
    // ago and never committed in has drifted far behind the baseline and is just as live.
    expect(call(["empty-workspace"], ["empty-workspace"]).size).toBe(0);
  });
});

describe("isArtifactDir", () => {
  it("accepts regenerable build dirs and rejects source dirs", () => {
    expect(isArtifactDir("target")).toBe(true);
    expect(isArtifactDir(".svelte-kit")).toBe(true);
    expect(isArtifactDir("src")).toBe(false);
  });
});
