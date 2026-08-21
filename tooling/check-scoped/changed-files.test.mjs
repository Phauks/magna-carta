import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChangedFiles, parseBaseFlag, partitionByTool } from "./changed-files.mjs";

describe("parseBaseFlag", () => {
  it("reads the ref after --base", () => {
    expect(parseBaseFlag(["--base", "abc1234"])).toBe("abc1234");
  });

  it("is null when --base is absent, so the trunk merge-base decides", () => {
    expect(parseBaseFlag(["--no-lint"])).toBeNull();
  });

  it("is null when --base is passed with no ref, rather than swallowing the next flag", () => {
    expect(parseBaseFlag(["--base"])).toBeNull();
  });
});

describe("partitionByTool", () => {
  it("routes each path to the passes that can actually parse it", () => {
    const { scripts, lintOnly, formatOnly } = partitionByTool([
      "apps/web-worker/src/lib/thing.ts",
      "tooling/check-scoped/fix.mjs",
      "apps/web-worker/src/lib/thing.svelte",
      "docs/conventions/build-performance.md",
      "package.json",
      "apps/web-worker/src/app.css",
      "pnpm-workspace.yaml",
      "osv-scanner.toml",
      "crates/engine-host/src/format.rs",
      "packages/database/migrations/0001_init.sql",
    ]);

    expect(scripts).toEqual(["apps/web-worker/src/lib/thing.ts", "tooling/check-scoped/fix.mjs"]);
    expect(lintOnly).toEqual(["apps/web-worker/src/lib/thing.svelte"]);
    expect(formatOnly).toEqual([
      "docs/conventions/build-performance.md",
      "package.json",
      "apps/web-worker/src/app.css",
      "pnpm-workspace.yaml",
      "osv-scanner.toml",
    ]);
  });

  it("includes markdown — a docs-only change is exactly what the scoped fixer is for", () => {
    expect(partitionByTool(["CHANGELOG.md"]).formatOnly).toEqual(["CHANGELOG.md"]);
  });

  it("hands the formatter and linter nothing they cannot parse", () => {
    const groups = partitionByTool(["crates/engine-host/src/format.rs", "docs/diagram.png"]);

    expect(groups).toEqual({ scripts: [], lintOnly: [], formatOnly: [] });
  });
});

// The change set against real git: committed-since-base, unstaged, staged, and untracked all count, a
// deleted file does not (the formatter can only be pointed at files that exist), and a file the trunk
// changed after the fork point stays out of the set.
describe("collectChangedFiles against a real repository", () => {
  let repository;
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();

  beforeEach(() => {
    repository = mkdtempSync(path.join(tmpdir(), "check-scoped-changed-files-"));
    git("init", "--initial-branch=main", "--quiet");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    const write = (file, body) => {
      mkdirSync(path.join(repository, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(repository, file), body);
    };
    const commit = (message, files) => {
      for (const [file, body] of Object.entries(files)) write(file, body);
      git("add", "--all");
      git("commit", "--quiet", "-m", message);
    };

    commit("base", { "kept.ts": "export const kept = 1;\n", "doomed.ts": "export const x = 1;\n" });
    git("checkout", "--quiet", "-b", "feature");
    commit("committed on the branch", { "docs/note.md": "# note\n" });
    git("rm", "--quiet", "doomed.ts");
    git("commit", "--quiet", "-m", "delete a file");
    write("staged.json", "{}\n");
    git("add", "staged.json");
    write("kept.ts", "export const kept = 2;\n");
    write("untracked.svelte", "<div></div>\n");
  });

  afterEach(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  it("collects the commits, the working tree, the index and untracked files — but not deletions", () => {
    const base = git("rev-parse", "main");

    const files = collectChangedFiles({ base, root: repository });

    expect(files.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      "docs/note.md",
      "kept.ts",
      "staged.json",
      "untracked.svelte",
    ]);
    expect(files).not.toContain("doomed.ts");
  });

  it("reports each path once even when it is both staged and modified", () => {
    const base = git("rev-parse", "main");
    writeFileSync(path.join(repository, "staged.json"), '{ "changed": true }\n');

    const files = collectChangedFiles({ base, root: repository });

    expect(files.filter((file) => file === "staged.json")).toHaveLength(1);
  });
});
