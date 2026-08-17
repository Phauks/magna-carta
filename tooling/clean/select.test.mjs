import { describe, expect, it } from "vitest";
import {
  eligibleWorktrees,
  isArtifactDir,
  normalizePath,
  STALE_WORKING_DIRECTORY_AGE_MS,
  staleWorkingDirectories,
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

describe("isArtifactDir", () => {
  it("accepts regenerable build dirs and rejects source dirs", () => {
    expect(isArtifactDir("target")).toBe(true);
    expect(isArtifactDir(".svelte-kit")).toBe(true);
    expect(isArtifactDir("src")).toBe(false);
  });
});

describe("staleWorkingDirectories", () => {
  const NOW = 1_760_000_000_000;
  const old = NOW - STALE_WORKING_DIRECTORY_AGE_MS - 1;
  const entry = (name, overrides = {}) => ({
    name,
    isDirectory: true,
    modifiedMs: old,
    ...overrides,
  });
  const names = (entries) => staleWorkingDirectories({ entries, now: NOW }).map((e) => e.name);

  it("selects an abandoned working copy", () => {
    expect(names([entry("mc-load-profile-a1B2c3")])).toEqual(["mc-load-profile-a1B2c3"]);
  });

  it("leaves a working copy that a run in flight could still be using", () => {
    // The age bound is the entire safety argument for deleting by name — a minutes-old directory
    // belongs to a live measurement run, and taking it would destroy that run's database.
    expect(names([entry("mc-load-profile-a1B2c3", { modifiedMs: NOW - 60_000 })])).toEqual([]);
    // Exactly at the bound counts as stale; a millisecond inside it does not.
    const boundary = NOW - STALE_WORKING_DIRECTORY_AGE_MS;
    expect(names([entry("mc-load-profile-a1B2c3", { modifiedMs: boundary })])).toHaveLength(1);
    expect(names([entry("mc-load-profile-a1B2c3", { modifiedMs: boundary + 1 })])).toHaveLength(0);
  });

  it("does not take the fixture cache, which shares the prefix but not the shape", () => {
    // `mc-load-profile-cache-XXXXXX` is created and reaped by the snapshot tests. It starts with the
    // same prefix, so a prefix match would sweep another creator's directory out from under it.
    expect(names([entry("mc-load-profile-cache-a1B2c3")])).toEqual([]);
  });

  it("stays inside its own prefix", () => {
    expect(
      names([
        entry("mc-node-sqlite-a1B2c3"),
        entry("mc-smoke-cache-a1B2c3"),
        entry("systemd-private-abc"),
        entry("tmp"),
        entry("load-profile-a1B2c3"),
      ]),
    ).toEqual([]);
  });

  it("ignores a file that happens to be named like one", () => {
    expect(names([entry("mc-load-profile-a1B2c3", { isDirectory: false })])).toEqual([]);
  });

  it("requires the full six-character mkdtemp suffix", () => {
    expect(
      names([
        entry("mc-load-profile-"),
        entry("mc-load-profile-a1B2c"),
        entry("mc-load-profile-a1B2c3d"),
        entry("mc-load-profile-a1B2c3/nested"),
        entry("mc-load-profile-a1_2c3"),
      ]),
    ).toEqual([]);
  });
});
