// The change set the scoped tools work from — one implementation, two callers.
//
// `pnpm check:scoped` (index.mjs) verifies the current change; `pnpm fix:scoped` (fix.mjs) formats and
// autofixes it. They must agree on exactly which files "the current change" means, or the fixer would
// rewrite a different set of files than the gate checks. That set is the diff against the base
// diff-base.mjs resolves, plus everything in the working tree: unstaged, staged, and untracked. Deleted
// paths are dropped — fmt and lint can only be pointed at files that exist.
//
// The tool split below is what the toolchain actually accepts, measured rather than assumed:
//   * `.svelte` is LINT-ONLY. The formatter has no Svelte parser and hard-errors ("Expected at least one
//     target file") when every path it is given is a `.svelte` file, so those paths go through with
//     `--no-fmt`.
//   * markdown, JSON, CSS, HTML, YAML and TOML are FORMAT-ONLY. The linter has no rules for them and
//     hard-errors ("No files found to lint") when handed one, so those paths go through with `--no-lint`.
//   * the script extensions take both passes.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDiffBase } from "./diff-base.mjs";

/** Repository root — this file lives at `tooling/check-scoped/`. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Formatted and linted. */
export const SCRIPT_PATTERN = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
/** Linted only — the formatter cannot parse these. */
export const LINT_ONLY_PATTERN = /\.svelte$/;
/** Formatted only — the linter has no rules for these. */
export const FORMAT_ONLY_PATTERN = /\.(md|json|jsonc|css|html|ya?ml|toml)$/;

/** git's newline-separated path output as a trimmed, blank-free list. */
const lines = (out) =>
  out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** `--base <ref>` from a command line, or null when it was not passed. */
export function parseBaseFlag(argv) {
  const index = argv.indexOf("--base");
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

/**
 * The commit the change is measured from: `--base <ref>` when given, otherwise whichever trunk
 * merge-base diff-base.mjs picks.
 */
export function resolveBase({ explicitBase = null, root = ROOT } = {}) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim();
  return resolveDiffBase({
    explicitBase,
    mergeBaseWith: (ref) => {
      try {
        return git(["merge-base", "HEAD", ref]);
      } catch {
        return null; // ref absent in this worktree
      }
    },
    isAncestor: (ancestor, descendant) => {
      const probe = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
        cwd: root,
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      return probe.status === 0;
    },
  });
}

/**
 * Every repo-relative path the current change touches and that still exists on disk: committed since
 * `base`, plus unstaged, staged, and untracked working-tree files.
 */
export function collectChangedFiles({ base, root = ROOT }) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  const changed = [
    ...lines(git(["diff", "--name-only", `${base}...HEAD`])),
    ...lines(git(["diff", "--name-only", "HEAD"])),
    ...lines(git(["diff", "--name-only", "--cached"])),
    ...lines(git(["ls-files", "--others", "--exclude-standard"])),
  ];
  return [...new Set(changed)].filter((file) => existsSync(path.join(root, file)));
}

/**
 * Split a change set by which passes can accept each path. Everything else in the change — Rust,
 * images, lockfiles, SQL — belongs to no group and is simply not handed to the formatter or linter.
 */
export function partitionByTool(files) {
  return {
    scripts: files.filter((file) => SCRIPT_PATTERN.test(file)),
    lintOnly: files.filter((file) => LINT_ONLY_PATTERN.test(file)),
    formatOnly: files.filter((file) => FORMAT_ONLY_PATTERN.test(file)),
  };
}
