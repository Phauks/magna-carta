import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_TRUNK_FALLBACK, resolveDiffBase } from "./diff-base.mjs";

// A tiny commit graph stands in for the real one. `ancestry` maps a commit to everything it descends
// from, which is all `isAncestor` needs to answer.
const ancestry = {
  "old-base": [],
  "new-base": ["old-base"],
  unrelated: [],
};
const isAncestor = (ancestor, descendant) =>
  (ancestry[descendant] ?? []).includes(ancestor) || ancestor === descendant;

describe("resolveDiffBase", () => {
  it("takes an explicit --base over anything git would say", () => {
    const base = resolveDiffBase({
      explicitBase: "abc1234",
      mergeBaseWith: () => "new-base",
      isAncestor,
    });

    expect(base).toBe("abc1234");
  });

  it("prefers origin/main when the local main ref is frozen behind it", () => {
    // The agent-worktree case: the clone's `main` has not moved since it was made, so its merge-base is
    // an ancestor of the one origin/main gives — diffing from it would scope the gate to hundreds of
    // files the current change never touched.
    const base = resolveDiffBase({
      explicitBase: null,
      mergeBaseWith: (ref) => (ref === "origin/main" ? "new-base" : "old-base"),
      isAncestor,
    });

    expect(base).toBe("new-base");
  });

  it("prefers local main when it is the one that has moved ahead", () => {
    // Just-merged-locally, not yet fetched: the newest merge-base is still the answer, whichever ref
    // carries it.
    const base = resolveDiffBase({
      explicitBase: null,
      mergeBaseWith: (ref) => (ref === "origin/main" ? "old-base" : "new-base"),
      isAncestor,
    });

    expect(base).toBe("new-base");
  });

  it("keeps the single answer when both refs agree", () => {
    const base = resolveDiffBase({
      explicitBase: null,
      mergeBaseWith: () => "new-base",
      isAncestor,
    });

    expect(base).toBe("new-base");
  });

  it("uses whichever ref resolves when the other is absent", () => {
    const base = resolveDiffBase({
      explicitBase: null,
      mergeBaseWith: (ref) => (ref === "origin/main" ? null : "old-base"),
      isAncestor,
    });

    expect(base).toBe("old-base");
  });

  it("falls back to the previous commit when no trunk ref resolves at all", () => {
    const base = resolveDiffBase({
      explicitBase: null,
      mergeBaseWith: () => null,
      isAncestor,
    });

    expect(base).toBe(NO_TRUNK_FALLBACK);
  });

  it("keeps the first candidate when two bases sit on unrelated histories", () => {
    // Neither contains the other, so there is no "newer" — picking arbitrarily but deterministically
    // beats claiming an ordering that does not exist.
    const base = resolveDiffBase({
      explicitBase: null,
      mergeBaseWith: (ref) => (ref === "origin/main" ? "old-base" : "unrelated"),
      isAncestor,
    });

    expect(base).toBe("old-base");
  });
});

// The same decision against real git, in a repository shaped exactly like an agent worktree: a local
// `main` left where the clone found it while `origin/main` moved on.
describe("resolveDiffBase against a real repository", () => {
  let repository;
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();

  beforeEach(() => {
    repository = mkdtempSync(path.join(tmpdir(), "check-scoped-diff-base-"));
    git("init", "--initial-branch=main", "--quiet");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    const commit = (message, file) => {
      writeFileSync(path.join(repository, file), message);
      git("add", ".");
      git("commit", "--quiet", "-m", message);
      return git("rev-parse", "HEAD");
    };

    commit("clone point", "one.txt");
    // `origin/main` is a real ref in a clone; a bare `update-ref` reproduces one without a remote.
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    // Trunk moves on and the remote-tracking ref follows it, while the local `main` BRANCH stays where
    // the clone left it — the state every agent worktree is in.
    git("checkout", "--quiet", "-b", "trunk");
    const advanced = commit("trunk moves on", "two.txt");
    git("update-ref", "refs/remotes/origin/main", advanced);
    // The change under test is branched off the current trunk, as a fresh branch would be.
    git("checkout", "--quiet", "-b", "feature");
    commit("the change under test", "three.txt");
  });

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  it("diffs from the tip of origin/main, not from the frozen local main", () => {
    const mergeBaseWith = (ref) => {
      try {
        return execFileSync("git", ["merge-base", "HEAD", ref], {
          cwd: repository,
          encoding: "utf8",
        }).trim();
      } catch {
        return null;
      }
    };
    const realIsAncestor = (ancestor, descendant) => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
          cwd: repository,
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    };

    const base = resolveDiffBase({ explicitBase: null, mergeBaseWith, isAncestor: realIsAncestor });

    expect(base).toBe(git("rev-parse", "refs/remotes/origin/main"));
    expect(base).not.toBe(git("rev-parse", "main"));

    // What this buys: the diff covers only the change, not everything trunk landed in the meantime.
    const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: repository,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(changed).toEqual(["three.txt"]);
  });
});
