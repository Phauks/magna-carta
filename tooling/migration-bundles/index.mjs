/*
 * Write the worker's migration bundle modules from the journals, or check that they still agree.
 *
 * The rules and the emitted text are ./bundle-module.mjs; this is the filesystem half, on the same
 * split every scan in tooling/ uses.
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
const checkOnly = process.argv.includes("--check");

const drifted = [];
const written = [];

for (const [lineage, shape] of Object.entries(LINEAGES)) {
  const journalPath = path.join(
    ROOT,
    "packages",
    "database",
    "drizzle",
    lineage,
    "meta",
    "_journal.json",
  );
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    // A journal this reads as empty would generate a module that bundles nothing, and the runtime
    // would then apply no migrations at all — the one failure a generator must never produce
    // quietly.
    console.error(`migration-bundles: ${lineage} journal has no entries — refusing to generate`);
    process.exit(1);
  }

  const expected = bundleModuleText(lineage, journal.entries);
  const modulePath = path.join(ROOT, shape.module);
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

if (checkOnly) {
  if (drifted.length > 0) {
    console.error("Migration bundle modules no longer match their journals:\n");
    for (const entry of drifted) {
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
  process.exit(0);
}

if (written.length === 0) {
  console.log("migration-bundles: both lineage modules already match their journals.");
} else {
  for (const module of written) console.log(`migration-bundles: wrote ${module}`);
}
