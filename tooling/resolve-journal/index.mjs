/*
 * Resolve a drizzle migration journal after a merge — or repair one that is already inverted.
 *
 * The rules are ./resolution.mjs, which has neither git nor a filesystem in it; this is the half
 * that reads the conflict stages, renames the `.sql` files and regenerates the worker bundles. Same
 * split as every scan in tooling/.
 *
 * WHAT IT DOES, in order, per lineage:
 *   1. reads `main`'s journal (the deployed lineage — `main` IS production here),
 *   2. reads the sides being resolved: git's conflict stages when the journal is unmerged, or the
 *      one journal on disk when it is not (the repair case),
 *   3. writes the union with dense `idx`, trunk entries first and in their own order,
 *   4. re-stamps every migration that is not on `main` and does not already sort above the head,
 *      renaming its `.sql` to match,
 *   5. regenerates the worker bundle modules, which import those `.sql` files by name.
 *
 * Step 5 is not optional and not a follow-up: a resolution that renames a migration and leaves the
 * bundle naming the old tag has moved the breakage rather than fixed it.
 *
 * usage: node tooling/resolve-journal/index.mjs [<lineage>...] [--base <ref>] [--dry-run]
 *   <lineage>     control-plane | per-firm; both when none is named
 *   --base <ref>  the trunk to measure against (default: origin/main, falling back to main)
 *   --dry-run     print the plan and touch nothing
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBundles, journalPathFor } from "../migration-bundles/index.mjs";
import { LINEAGES } from "../migration-bundles/bundle-module.mjs";
import { applyOrderIsIntegrationOrder, resolveJournal } from "./resolution.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WINDOWS = process.platform === "win32";

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", shell: WINDOWS });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

/** The first trunk ref that exists here. `main` is production, so it is what "deployed" means. */
export function resolveTrunkRef(explicit) {
  const candidates = explicit ? [explicit] : ["origin/main", "main"];
  for (const ref of candidates) {
    const probe = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: ROOT,
      stdio: "ignore",
      shell: WINDOWS,
    });
    if (probe.status === 0) return ref;
  }
  return null;
}

/** The repo-relative path of a lineage's journal, in git's forward-slash spelling. */
function journalRepoPath(lineage) {
  return `packages/database/drizzle/${lineage}/meta/_journal.json`;
}

/**
 * The journals to resolve. During a conflicted merge git holds both sides in the index as stages 2
 * (ours) and 3 (theirs), and the working-tree copy is the conflict markers — which is not JSON, so
 * it must never be read in that state. With no conflict there is one side: the journal on disk.
 *
 * Whole journals rather than their `entries`, because the resolved file keeps the rest of the
 * journal (`version`, `dialect`) and there is no copy of those to fall back on while the working
 * tree holds markers.
 */
function journalsFor(lineage) {
  const repoPath = journalRepoPath(lineage);
  const unmerged = git(["ls-files", "-u", "--", repoPath], { allowFailure: true }) ?? "";
  const stages = new Set(
    unmerged
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/u)[2]),
  );
  if (stages.has("2") && stages.has("3")) {
    return {
      conflicted: true,
      journals: [
        JSON.parse(git(["show", `:2:${repoPath}`])),
        JSON.parse(git(["show", `:3:${repoPath}`])),
      ],
    };
  }
  return {
    conflicted: false,
    journals: [JSON.parse(readFileSync(journalPathFor(lineage, { root: ROOT }), "utf8"))],
  };
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const baseIndex = argv.indexOf("--base");
  const explicitBase = baseIndex === -1 ? null : (argv[baseIndex + 1] ?? null);
  if (baseIndex !== -1 && explicitBase === null) {
    console.error("resolve-journal: --base needs a ref");
    process.exit(2);
  }
  const named = argv.filter((argument) => !argument.startsWith("--") && argument !== explicitBase);
  const unknown = named.filter((lineage) => !(lineage in LINEAGES));
  if (unknown.length > 0) {
    console.error(
      `resolve-journal: unknown lineage ${unknown.join(", ")} — expected ${Object.keys(LINEAGES).join(" or ")}`,
    );
    process.exit(2);
  }
  const lineages = named.length > 0 ? named : Object.keys(LINEAGES);

  const trunkRef = resolveTrunkRef(explicitBase);
  if (trunkRef === null) {
    console.error(
      `resolve-journal: no trunk ref to measure against (tried ${explicitBase ?? "origin/main, main"}). ` +
        "Fetch it first — which migrations have DEPLOYED is the whole input to this, and there is no " +
        "safe guess.",
    );
    process.exit(1);
  }

  let touched = false;
  for (const lineage of lineages) {
    const repoPath = journalRepoPath(lineage);
    const trunkText = git(["show", `${trunkRef}:${repoPath}`], { allowFailure: true });
    if (trunkText === null) {
      console.error(
        `resolve-journal: ${lineage} has no journal at ${trunkRef} — refusing to guess`,
      );
      process.exit(1);
    }
    const trunk = JSON.parse(trunkText).entries;
    const { conflicted, journals } = journalsFor(lineage);

    // The resolved file keeps everything the journal says that is not its entry list. Both sides
    // agree on it — drizzle writes the same `version` and `dialect` every time — so either will do.
    const envelope = journals[0];
    const { entries, renames } = resolveJournal({
      trunk,
      sides: journals.map((journal) => journal.entries),
    });

    const unchanged =
      !conflicted &&
      renames.length === 0 &&
      JSON.stringify(envelope.entries) === JSON.stringify(entries);
    if (unchanged) {
      console.log(`resolve-journal: ${lineage} is already resolved and in apply order.`);
      continue;
    }

    console.log(
      `resolve-journal: ${lineage} — ${conflicted ? "conflicted" : "on disk"}, ${entries.length} migration(s) against ${trunkRef}`,
    );
    for (const rename of renames) console.log(`  re-stamp  ${rename.from} -> ${rename.to}`);
    if (renames.length === 0) console.log("  no re-stamp needed; only idx was renumbered");
    if (dryRun) continue;

    const lineageDirectory = path.join(ROOT, "packages", "database", "drizzle", lineage);
    for (const rename of renames) {
      const from = path.join(lineageDirectory, `${rename.from}.sql`);
      const to = path.join(lineageDirectory, `${rename.to}.sql`);
      if (!existsSync(from)) {
        console.error(
          `resolve-journal: ${lineage} names ${rename.from} but ${rename.from}.sql is not on disk. ` +
            "Resolve the .sql files first — a journal entry with no SQL behind it fails every " +
            "database on wake.",
        );
        process.exit(1);
      }
      renameSync(from, to);
    }

    writeFileSync(
      journalPathFor(lineage, { root: ROOT }),
      `${JSON.stringify({ ...envelope, entries }, null, 2)}\n`,
    );
    // Staged, because a conflicted path stays conflicted until it is — and because the renames are
    // only half-recorded otherwise. The commit is still the caller's to make.
    git(["add", "--", `packages/database/drizzle/${lineage}`]);
    touched = true;

    if (!applyOrderIsIntegrationOrder(entries)) {
      // Unreachable by construction; asserted anyway, because a resolution that silently leaves the
      // lineage inverted is the exact failure this tool was written to end.
      console.error(`resolve-journal: ${lineage} is still out of apply order after resolution`);
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log("resolve-journal: dry run — nothing written.");
    return;
  }
  if (!touched) return;

  const { written } = generateBundles({ root: ROOT });
  for (const module of written) console.log(`resolve-journal: regenerated ${module}`);
  if (written.length > 0) git(["add", "--", ...written]);
  console.log(
    "resolve-journal: done. Review the diff, then refresh the drizzle snapshot if a migration " +
      "was added (`pnpm --filter @magna-carta/database run check-snapshots`).",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
