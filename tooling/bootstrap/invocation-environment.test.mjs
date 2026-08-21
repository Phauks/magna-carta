import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callerDirectory,
  dependenciesInstalled,
  enclosingCheckout,
  refusalReason,
} from "./invocation-environment.mjs";

// The failure being guarded, reconstructed on disk: a checkout with a second checkout nested inside it
// (worktrees live under .claude/worktrees/), where the nested one has no node_modules. Running
// bootstrap from the nested one resolves `vp` — and therefore the whole run — out of the outer one.

let workspace;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "bootstrap-invocation-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** A checkout of the monorepo at `relative`, with or without its dependencies installed. */
function checkout(relative, { installed }) {
  const root = path.join(workspace, relative);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  if (installed) mkdirSync(path.join(root, "node_modules", "vite-plus"), { recursive: true });
  return root;
}

function directory(relative) {
  const target = path.join(workspace, relative);
  mkdirSync(target, { recursive: true });
  return target;
}

describe("enclosingCheckout", () => {
  it("finds the checkout a subdirectory belongs to", () => {
    const root = checkout("repo", { installed: true });
    directory("repo/tooling/bootstrap");

    expect(enclosingCheckout(path.join(root, "tooling/bootstrap"))).toBe(root);
  });

  it("stops at the NEAREST checkout, so a nested worktree is not read as part of its parent", () => {
    checkout("repo", { installed: true });
    const worktree = checkout("repo/.claude/worktrees/feature", { installed: false });

    // The path-prefix answer would be `repo`. It is wrong: this is a checkout of its own.
    expect(enclosingCheckout(worktree)).toBe(worktree);
  });

  it("reports a directory outside any checkout rather than throwing", () => {
    expect(enclosingCheckout(directory("loose"))).toBeNull();
  });
});

describe("dependenciesInstalled", () => {
  it("sees an installed checkout", () => {
    expect(dependenciesInstalled(checkout("repo", { installed: true }))).toBe(true);
  });

  it("sees a freshly-created worktree, which has none", () => {
    expect(dependenciesInstalled(checkout("repo", { installed: false }))).toBe(false);
  });
});

describe("refusalReason", () => {
  it("refuses when the run was started from a DIFFERENT checkout than the script belongs to", () => {
    // The reported failure: `pnpm exec vp run bootstrap` in an uninstalled worktree walks up, finds the
    // parent checkout's `vp`, and runs the parent's bootstrap — which has nothing to do, so it exits 0
    // while the worktree stays unbootstrapped. This is the one condition that proves it happened.
    const parent = checkout("repo", { installed: true });
    const worktree = checkout("repo/.claude/worktrees/feature", { installed: false });

    const refusal = refusalReason({ scriptRoot: parent, invokedFrom: worktree });

    expect(refusal).toContain(worktree);
    expect(refusal).toContain("pnpm install");
  });

  it("refuses when the checkout it is running in has no dependencies installed", () => {
    const root = checkout("repo", { installed: false });

    expect(refusalReason({ scriptRoot: root, invokedFrom: root })).toContain("pnpm install");
  });

  it("allows a run started from a subdirectory of the script's own checkout", () => {
    const root = checkout("repo", { installed: true });

    expect(
      refusalReason({ scriptRoot: root, invokedFrom: directory("repo/apps/web-worker") }),
    ).toBeNull();
  });

  it("allows a run whose caller directory is unknown rather than guessing a mismatch", () => {
    // Not every shell exports one. An unprovable mismatch is not a mismatch.
    const root = checkout("repo", { installed: true });

    expect(refusalReason({ scriptRoot: root, invokedFrom: undefined })).toBeNull();
  });

  it("still refuses an uninstalled checkout when the caller directory is unknown", () => {
    const root = checkout("repo", { installed: false });

    expect(refusalReason({ scriptRoot: root, invokedFrom: undefined })).toContain("pnpm install");
  });

  it("allows a caller standing outside any checkout, which proves nothing either way", () => {
    const root = checkout("repo", { installed: true });

    expect(refusalReason({ scriptRoot: root, invokedFrom: directory("loose") })).toBeNull();
  });
});

describe("callerDirectory", () => {
  it("prefers INIT_CWD, which package scripts set", () => {
    expect(callerDirectory({ INIT_CWD: "/from/script", PWD: "/from/shell" })).toBe("/from/script");
  });

  it("falls back to PWD, which is what survives `vp run`", () => {
    expect(callerDirectory({ PWD: "/from/shell" })).toBe("/from/shell");
  });

  it("reports neither being set as unknown", () => {
    expect(callerDirectory({})).toBeUndefined();
  });
});
