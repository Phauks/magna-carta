import { describe, expect, it } from "vitest";
import { eligibleWorktrees, isArtifactDir, normalizePath } from "./select.mjs";

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
  });
});

describe("normalizePath", () => {
  it("uses forward slashes, a lowercase drive letter, and no trailing slash", () => {
    expect(normalizePath("C:\\dev\\Foo\\")).toBe("c:/dev/Foo");
  });
});

describe("isArtifactDir", () => {
  it("accepts regenerable build dirs and rejects source dirs", () => {
    expect(isArtifactDir("target")).toBe(true);
    expect(isArtifactDir(".svelte-kit")).toBe(true);
    expect(isArtifactDir("src")).toBe(false);
  });
});
