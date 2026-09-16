/*
 * Refuse a change to a migration that has already deployed.
 *
 * The rules are ./immutability.mts; this is the half that reads `main` out of git and the lineage
 * off disk. Same split as every scan in tooling/.
 *
 * WHY GIT. There is no other record of what has deployed. `main` IS production here — a merge
 * reaches real users within minutes, with no second gesture — so `main`'s copy of a lineage is the
 * copy the fleet is running, and nothing committed on a branch can tell you that. A ledger file
 * listing "the deployed tags" would be the same fact kept twice, free to disagree with the branch
 * that forgot to update it.
 *
 * WHAT IT NEEDS. A trunk ref — `origin/main`, or `main` — to take a merge base with. A shallow
 * checkout has neither, and a gate
 * that quietly passes because it could not find its own input is worse than no gate — so with CI
 * set, a missing trunk ref FAILS and names the fetch it needs. Off CI it reports and exits clean:
 * a worktree with no trunk ref is a developer who cannot fix it from here, and blocking them buys
 * nothing the pull request will not catch.
 *
 * usage: node tooling/migration-immutability/index.mts [--base <ref>]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_BASELINES } from "../../packages/database/src/legacy-baselines.ts";
import type { MigrationJournal } from "../../packages/database/src/migration.ts";
import { ALLOWED_CHANGES } from "./allowed-changes.mts";
import { immutabilityViolations } from "./immutability.mts";

const ROOT = join(import.meta.dirname, "..", "..");
const WINDOWS = process.platform === "win32";
const LINEAGES = ["control-plane", "per-firm"] as const;
type Lineage = (typeof LINEAGES)[number];

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", shell: WINDOWS });
  } catch {
    return null;
  }
}

/**
 * The commit to measure "deployed" from: where this branch left `main`, not `main`'s tip.
 *
 * The difference matters on every pull request open for more than a day. A migration that landed on
 * `main` after the branch forked is on the tip and not on the branch — and measured against the tip
 * it reads as a migration the branch DELETED, which is a false alarm on work that did nothing wrong.
 * The merge base is what the branch actually inherited, and it is no weaker a bar: a tag on it
 * deployed just as surely, and a migration main added since survives the merge on its own.
 */
function deployedFrom(explicit: string | null): string | null {
  for (const ref of explicit === null ? ["origin/main", "main"] : [explicit]) {
    if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) continue;
    const mergeBase = git(["merge-base", ref, "HEAD"])?.trim();
    return mergeBase !== undefined && mergeBase !== "" ? mergeBase : ref;
  }
  return null;
}

const lineageDirectory = (lineage: Lineage) => `packages/database/drizzle/${lineage}`;

/** A lineage's tag-to-SQL map as of one commit, read out of git rather than off disk. */
function deployedAt(ref: string, lineage: Lineage): ReadonlyMap<string, string> | null {
  const journalText = git(["show", `${ref}:${lineageDirectory(lineage)}/meta/_journal.json`]);
  if (journalText === null) return null;
  const journal = JSON.parse(journalText) as MigrationJournal;
  const sql = new Map<string, string>();
  for (const entry of journal.entries) {
    const text = git(["show", `${ref}:${lineageDirectory(lineage)}/${entry.tag}.sql`]);
    if (text === null) {
      // A journal entry with no SQL behind it at that commit. That is a broken `main`, not a
      // violation of this gate — say so rather than reporting it as an edit.
      console.error(
        `migration-immutability: ${ref} lists ${entry.tag} in ${lineage} but has no ` +
          `${entry.tag}.sql. That commit's lineage is incomplete; this gate cannot judge against it.`,
      );
      process.exit(1);
    }
    sql.set(entry.tag, text);
  }
  return sql;
}

/** The same map from the working tree. */
function currentState(lineage: Lineage): ReadonlyMap<string, string> {
  const directory = join(ROOT, "packages", "database", "drizzle", lineage);
  const journal = JSON.parse(
    readFileSync(join(directory, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sql = new Map<string, string>();
  for (const entry of journal.entries) {
    sql.set(entry.tag, readFileSync(join(directory, `${entry.tag}.sql`), "utf8"));
  }
  return sql;
}

/** Tags the runtime already reconciles to a later baseline, so their absence is expected. */
function reconciledByRuntime(lineage: Lineage): ReadonlySet<string> {
  return new Set(
    LEGACY_BASELINES.filter((baseline) => baseline.lineage === lineage).flatMap(
      (baseline) => baseline.legacyTags,
    ),
  );
}

const argv = process.argv.slice(2);
const baseIndex = argv.indexOf("--base");
if (baseIndex !== -1 && argv[baseIndex + 1] === undefined) {
  console.error("migration-immutability: --base needs a ref");
  process.exit(2);
}
const ref = deployedFrom(baseIndex === -1 ? null : (argv[baseIndex + 1] ?? null));

if (ref === null) {
  const message =
    "migration-immutability: no trunk ref to take a merge base with (tried origin/main, main). " +
    "Which migrations have DEPLOYED is the entire input to this check.";
  if (process.env["CI"]) {
    console.error(`${message} Fetch it — a shallow checkout needs fetch-depth: 0.`);
    process.exit(1);
  }
  console.log(`${message} Skipped here; the pull request runs it against a full checkout.`);
  process.exit(0);
}

const reports: { lineage: Lineage; violations: string[] }[] = [];
const counts: string[] = [];
for (const lineage of LINEAGES) {
  const deployed = deployedAt(ref, lineage);
  if (deployed === null) {
    // The lineage does not exist at the trunk ref — a brand-new lineage on this branch. Nothing has
    // deployed, so there is nothing immutable yet.
    counts.push(`${lineage} (new)`);
    continue;
  }
  counts.push(`${lineage} (${deployed.size} deployed)`);
  const violations = immutabilityViolations(
    lineage,
    { deployed, current: currentState(lineage), reconciledByRuntime: reconciledByRuntime(lineage) },
    ALLOWED_CHANGES,
  );
  if (violations.length > 0) reports.push({ lineage, violations });
}

if (reports.length > 0) {
  console.error(`migration-immutability: measured against ${ref} — where this branch left main\n`);
  for (const report of reports) {
    console.error(`  ${report.lineage} —`);
    for (const violation of report.violations) console.error(`    ${violation}\n`);
  }
  process.exit(1);
}

console.log(
  "migration-immutability: every migration this branch inherited from main is still here, " +
    `unchanged — ${counts.join(", ")} at ${ref.slice(0, 12)}`,
);
