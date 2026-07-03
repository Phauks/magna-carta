import { readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Shared file collector for the fitness sweeps (off-token.test.ts, boundaries.test.ts).
 *
 * A manual walk rather than `readdirSync(..., { recursive: true })` so excluded directories
 * (node_modules, build output) are PRUNED — never entered — instead of traversed and filtered:
 * the boundary sweep covers every workspace package, and walking pnpm's node_modules trees
 * would dominate the test's runtime. Symbolic links are not followed (a pnpm-linked workspace
 * package must be swept once, at its real path, not again through a consumer's node_modules).
 */

export interface SweepOptions {
  /** File extensions to collect, with the leading dot (".ts", ".svelte", ".css"). */
  readonly extensions: readonly string[];
  /** Directory NAMES pruned wherever they appear (e.g. "node_modules", "dist"). */
  readonly excludeDirectoryNames?: readonly string[];
  /**
   * Path prefixes (relative to the sweep root, forward-slash separated) pruned from the
   * result — for whole subtrees that are deliberately outside a rule's jurisdiction.
   */
  readonly excludePathPrefixes?: readonly string[];
}

/**
 * Recursively collect files under `rootDirectory`, returning forward-slash paths relative
 * to it, sorted. Throws if the root does not exist — a missing sweep root must fail loudly,
 * not produce an empty (vacuously passing) sweep.
 */
export function collectSourceFiles(rootDirectory: string, options: SweepOptions): string[] {
  const excludeDirectoryNames = new Set(options.excludeDirectoryNames ?? []);
  const excludePathPrefixes = options.excludePathPrefixes ?? [];
  const collected: string[] = [];

  function walk(relativePath: string): void {
    const entries = readdirSync(join(rootDirectory, relativePath), { withFileTypes: true });
    for (const entry of entries) {
      const entryRelativePath = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      if (excludePathPrefixes.some((prefix) => entryRelativePath.startsWith(prefix))) continue;
      if (entry.isDirectory()) {
        if (excludeDirectoryNames.has(entry.name)) continue;
        walk(entryRelativePath);
      } else if (entry.isFile()) {
        if (options.extensions.some((extension) => entry.name.endsWith(extension))) {
          collected.push(entryRelativePath);
        }
      }
      // Symbolic links (pnpm workspace links, junctions) are deliberately skipped — see header.
    }
  }

  walk("");
  return collected.sort();
}
