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
// A fresh worktree has no node_modules at all, and this check now leads the whole-repo chain — so an
// uninstalled tree meets a module-resolution stack trace before anything else has run. Name the cause
// and the fix instead, the same way the wasm-artefact guard in tooling/check-scoped does.
let drizzleKitBinary;
try {
  drizzleKitBinary = join(dirname(require.resolve("drizzle-kit")), "bin.cjs");
} catch {
  console.error(
    "refresh-snapshot: drizzle-kit is not installed, so snapshot freshness cannot be checked.\n" +
      "    Run `pnpm install` first — a fresh worktree starts with no node_modules.",
  );
  process.exit(1);
}

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
  // DRIZZLE-KIT CAN FAIL AND EXIT 0, so the status alone is not the answer. Measured on the pinned
  // version against a lineage with two snapshots naming one parent: it prints
  // `Error: […] are pointing to a parent snapshot … which is a collision`, writes nothing, and exits
  // 0. Read by status alone, that is indistinguishable from "the schema matches the snapshot" —
  // `produced === seeded` below — so this check reported "nothing to do" on a lineage where every
  // generate was refusing. An `Error:` line on either stream is therefore a failure whatever the
  // status says.
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const reportedError = /^Error:/m.test(output);
  if (result.status !== 0 || reportedError) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    throw new Error(
      `drizzle-kit generate failed for ${lineage}` +
        (result.status === 0 ? " (it reported an error and exited 0)" : ""),
    );
  }

  const produced = highestSnapshot(join(scratchDirectory, "meta"));
  const seeded = highestSnapshot(seedMetaDirectory);
  if (produced === seeded) return null; // no new snapshot: no schema changes to record
  return {
    path: join(scratchDirectory, "meta", produced),
    migration: readdirSync(scratchDirectory).filter((file) => file.endsWith(".sql")),
  };
}

// TWO SNAPSHOTS NAMING ONE PARENT, which is what merging two branches that each added a migration
// leaves behind: each side wrote a snapshot at its own index, both descending from the snapshot
// they shared, and git keeps both. The chain is then a fork rather than a line, and drizzle refuses
// every generate against it.
//
// Checked HERE, before generating, rather than left to the generate to discover, because the
// generate's own report of it is a message on a stream the caller has to know to read (see the
// note in generateAgainst). This names the files and the repair instead. It is the specific case of
// the lineage rule tooling/migration-integrity enforces — every snapshot's parent is the one
// emitted before it — stated as the fork a merge actually produces, so the message can say which
// file to drop.
function siblingSnapshots(directory) {
  const childrenByParent = new Map();
  for (const file of readdirSync(directory)) {
    if (!/^\d{4}_snapshot\.json$/.test(file)) continue;
    const { prevId } = JSON.parse(readFileSync(join(directory, file), "utf8"));
    if (typeof prevId !== "string") continue;
    childrenByParent.set(prevId, [...(childrenByParent.get(prevId) ?? []), file]);
  }
  return [...childrenByParent.values()]
    .filter((files) => files.length > 1)
    .map((files) => files.toSorted());
}

// Returns the process exit code. Never calls process.exit itself, so the scratch folder is
// always swept by the finally below.
function refresh() {
  const forks = siblingSnapshots(metaDirectory);
  if (forks.length > 0) {
    // The repair is the same whichever mode this is in, and --check must not perform it: which
    // sibling is stale is decided by the journal, and a person should see the files before one goes.
    console.error(
      `${lineage}: the snapshot chain FORKS — these snapshots name the same parent, so drizzle will\n` +
        `refuse every generate against this lineage:\n` +
        forks.map((files) => `    ${files.join("  and  ")}`).join("\n") +
        `\n\nThis is what merging two branches that each added a migration leaves behind. REPAIR IT:\n` +
        `  1. KEEP the sibling that is already on main and delete the one your branch brought in —\n` +
        `     \`git ls-tree origin/main packages/database/drizzle/${lineage}/meta/\` names main's. Main's is the history\n` +
        `     every other branch already has; yours is rebuilt in the next step, from the schema;\n` +
        `  2. pnpm --filter @magna-carta/database run refresh-${lineage}-snapshot\n` +
        `     which rewrites ${headSnapshotName} from the schema, chained from the survivor;\n` +
        `  3. pnpm --filter @magna-carta/database run generate-${lineage}-migrations\n` +
        `     must then report "No schema changes" — that is the proof, not this check.`,
    );
    return 1;
  }

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
        `Re-verify with: pnpm --filter @magna-carta/database run check-snapshots, and let a\n` +
        `generate-${lineage}-migrations report "No schema changes" — the generate is the real proof.`,
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
