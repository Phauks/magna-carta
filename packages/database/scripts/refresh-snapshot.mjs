// Re-derive a lineage's drizzle SNAPSHOT from the current TypeScript schema, without
// emitting a migration.
//
// Why this exists: drizzle-kit only writes a snapshot as a side effect of `generate`, so a
// hand-written migration (the normal case here — raw partial indexes, FTS5, seeds, and
// column adds SQLite can only do in a specific order) advances the journal while the meta/
// snapshot stays where the last generate left it. Once the snapshot lags, the next
// `generate` diffs the schema against that stale state and re-emits every table added
// since — a migration that would fail on any already-provisioned firm. Refreshing the
// snapshot to the lineage head makes the generator diff correctly again.
//
// What it does: copies meta/ into a scratch out-folder, runs `drizzle-kit generate` there
// (so the throwaway .sql lands in the scratch folder, never in drizzle/), and adopts ONLY
// the snapshot it produced, filed under the journal head's idx. Then it re-runs the same
// generate against the repaired meta and requires it to emit nothing, so the script proves
// its own repair. Deletes the scratch folder either way.
//
// Safe to run any time: with no drift it reports "already current" and writes nothing.
//
// usage: node scripts/refresh-snapshot.mjs <control-plane|per-firm> [--check]
//        --check reports drift and exits 1 without writing (for a dry run).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

const LINEAGES = ["control-plane", "per-firm"];

const lineage = process.argv[2];
const checkOnly = process.argv.includes("--check");
if (!LINEAGES.includes(lineage)) {
  console.error(`usage: node scripts/refresh-snapshot.mjs <${LINEAGES.join("|")}> [--check]`);
  process.exit(2);
}

const packageRoot = join(import.meta.dirname, "..");
const lineageDirectory = join(packageRoot, "drizzle", lineage);
const metaDirectory = join(lineageDirectory, "meta");
// Relative, because drizzle-kit resolves --out against the working directory and rejects an
// absolute path. Removed in the finally block below.
const scratchRelative = `./.drizzle-snapshot-refresh/${lineage}`;
const scratchDirectory = join(packageRoot, ".drizzle-snapshot-refresh", lineage);

// The config file is the one home for this lineage's dialect and schema entry point; read them
// from it rather than restating them here. (drizzle-kit refuses --config alongside other flags,
// so the flags have to be spelled out on the command line.)
const configPath = join(packageRoot, `drizzle-${lineage}.config.ts`);
const configSource = readFileSync(configPath, "utf8");
function configField(field) {
  const match = new RegExp(`${field}:\\s*"([^"]+)"`).exec(configSource);
  if (match === null) {
    console.error(`could not read \`${field}\` out of ${configPath}`);
    process.exit(1);
  }
  return match[1];
}
const dialect = configField("dialect");
const schemaPath = configField("schema");
if (!existsSync(join(packageRoot, schemaPath))) {
  console.error(`schema entry point ${schemaPath} (from ${configPath}) does not exist`);
  process.exit(1);
}

const journal = JSON.parse(readFileSync(join(metaDirectory, "_journal.json"), "utf8"));
const headEntry = journal.entries.toSorted((a, b) => a.idx - b.idx).at(-1);
if (headEntry === undefined) {
  console.log(`${lineage}: journal empty, nothing to snapshot`);
  process.exit(0);
}
const headSnapshotName = `${String(headEntry.idx).padStart(4, "0")}_snapshot.json`;

// Run the CLI through node directly rather than a .bin shim, so the invocation is identical on
// every platform. drizzle-kit does not export its bin path, so resolve the package entry point
// and take the sibling the package.json `bin` field names.
const require = createRequire(import.meta.url);
const drizzleKitBinary = join(dirname(require.resolve("drizzle-kit")), "bin.cjs");

// drizzle-kit diffs against the highest-numbered snapshot in a meta folder, so that file is both
// the "before" it reads and the marker for whether it wrote a new one.
function highestSnapshot(directory) {
  return readdirSync(directory)
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .toSorted()
    .at(-1);
}

// Runs a generate in a throwaway copy of meta/ and returns the snapshot it produced, or null
// when the schema and the seeded snapshot already agree (drizzle writes nothing in that case).
function generateAgainst(seedMetaDirectory) {
  rmSync(scratchDirectory, { recursive: true, force: true });
  mkdirSync(scratchDirectory, { recursive: true });
  cpSync(seedMetaDirectory, join(scratchDirectory, "meta"), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      drizzleKitBinary,
      "generate",
      `--dialect=${dialect}`,
      `--schema=${schemaPath}`,
      `--out=${scratchRelative}`,
      "--name=snapshot-refresh",
    ],
    { cwd: packageRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    throw new Error(`drizzle-kit generate failed for ${lineage}`);
  }

  const produced = highestSnapshot(join(scratchDirectory, "meta"));
  const seeded = highestSnapshot(seedMetaDirectory);
  if (produced === seeded) return null; // no new snapshot: no schema changes to record
  return {
    path: join(scratchDirectory, "meta", produced),
    migration: readdirSync(scratchDirectory).filter((file) => file.endsWith(".sql")),
  };
}

// Returns the process exit code. Never calls process.exit itself, so the scratch folder is
// always swept by the finally below.
function refresh() {
  const drift = generateAgainst(metaDirectory);
  if (drift === null) {
    console.log(
      `${lineage}: snapshot already matches the schema (head ${headEntry.idx} ${headEntry.tag}) — nothing to do`,
    );
    return 0;
  }

  const driftSql = readFileSync(join(scratchDirectory, drift.migration[0]), "utf8");
  const driftStatements = driftSql.split("--> statement-breakpoint").length;
  console.log(
    `${lineage}: snapshot is BEHIND the schema — a generate here would re-emit ${driftStatements} ` +
      `statement${driftStatements === 1 ? "" : "s"}`,
  );
  if (checkOnly) {
    // A gate that only names the symptom costs the next reader a search, so spell the repair out:
    // the exact command, the file it rewrites, and the commit it belongs in.
    console.error(
      `${lineage}: --check, wrote nothing. REPAIR IT WITH\n` +
        `\n` +
        `    pnpm --filter @magna-carta/database run refresh-${lineage}-snapshot\n` +
        `\n` +
        `which rewrites drizzle/${lineage}/meta/${headSnapshotName} from the schema and proves the\n` +
        `repair settled. Commit that snapshot in the SAME commit as the migration — a hand-written\n` +
        `migration advances the journal but never the snapshot, which is what this drift is.\n` +
        `Re-verify with: pnpm --filter @magna-carta/database run check-snapshots`,
    );
    return 1;
  }

  cpSync(drift.path, join(metaDirectory, headSnapshotName));
  console.log(
    `${lineage}: adopted the regenerated snapshot as meta/${headSnapshotName} (journal head ${headEntry.tag})`,
  );

  // Prove it: the same generate against the repaired meta must now find nothing.
  const residual = generateAgainst(metaDirectory);
  if (residual !== null) {
    console.error(
      `${lineage}: REPAIR DID NOT SETTLE — a generate still emits ${relative(packageRoot, residual.path)}`,
    );
    return 1;
  }
  console.log(`${lineage}: verified — generate against the repaired snapshot emits nothing`);
  return 0;
}

try {
  process.exitCode = refresh();
} finally {
  rmSync(join(packageRoot, ".drizzle-snapshot-refresh"), { recursive: true, force: true });
}
