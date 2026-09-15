/*
 * Write the worker's migration bundle modules from the journals, or check that they still agree.
 *
 * The rules and the emitted text are ./bundle-module.mjs; this is the filesystem half, on the same
 * split every scan in tooling/ uses. `generateBundles` is exported because the journal resolver
 * (tooling/resolve-journal) finishes its own job by calling it — a resolution that renames a
 * migration and leaves the bundle naming the old tag has only moved the breakage.
 *
 * usage: node tooling/migration-bundles/index.mjs [--check]
 *   (no flag)  write each lineage's module
 *   --check    exit 1 naming any module that has drifted from its journal, writing nothing
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModuleText, LINEAGES } from "./bundle-module.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where a lineage's drizzle journal lives. */
export function journalPathFor(lineage, { root = ROOT } = {}) {
  return path.join(root, "packages", "database", "drizzle", lineage, "meta", "_journal.json");
}

/**
 * Bring every lineage module into line with its journal, or report which ones have drifted.
 *
 * @param {object} [options]
 * @param {boolean} [options.checkOnly] report instead of writing.
 * @returns {{ written: string[], drifted: { lineage: string, module: string, missing: boolean }[] }}
 */
export function generateBundles({ root = ROOT, checkOnly = false } = {}) {
  const written = [];
  const drifted = [];

  for (const [lineage, shape] of Object.entries(LINEAGES)) {
    const journal = JSON.parse(readFileSync(journalPathFor(lineage, { root }), "utf8"));
    if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
      // A journal this reads as empty would generate a module that bundles nothing, and the runtime
      // would then apply no migrations at all — the one failure a generator must never produce
      // quietly.
      throw new Error(`${lineage} journal has no entries — refusing to generate`);
    }

    const expected = bundleModuleText(lineage, journal.entries);
    const modulePath = path.join(root, shape.module);
    let current = "";
    try {
      current = readFileSync(modulePath, "utf8");
    } catch {
      current = "";
    }

    if (current === expected) continue;
    if (checkOnly) {
      drifted.push({ lineage, module: shape.module, missing: current === "" });
      continue;
    }
    writeFileSync(modulePath, expected);
    written.push(shape.module);
  }

  return { written, drifted };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  let result;
  try {
    result = generateBundles({ checkOnly });
  } catch (error) {
    console.error(`migration-bundles: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (!checkOnly) {
    if (result.written.length === 0) {
      console.log("migration-bundles: both lineage modules already match their journals.");
    } else {
      for (const module of result.written) console.log(`migration-bundles: wrote ${module}`);
    }
    return;
  }

  if (result.drifted.length > 0) {
    console.error("Migration bundle modules no longer match their journals:\n");
    for (const entry of result.drifted) {
      console.error(`  ${entry.module}`);
      console.error(
        entry.missing
          ? "    does not exist — run `pnpm run migration-bundles`\n"
          : "    drifted from the journal. A migration was added, renamed or removed and this " +
              "module was not regenerated (or it was edited by hand, which it must never be). " +
              "Run `pnpm run migration-bundles`.\n",
      );
    }
    process.exit(1);
  }
  console.log(
    `Migration bundles: ${Object.keys(LINEAGES).length} lineage module(s) match their journals — ` +
      "every migration in each journal has its SQL bundled, in apply order.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
