// @repo-wide-fitness — sweeps first-party source from the repository root for reads of a protected
// column, so any package's diff can break it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_COLUMNS } from "@magna-carta/database/protected-columns";

// Fitness function (the source-scan pattern): a protected column holds only ciphertext, and the
// data-access protected() chokepoint is the ONLY code that may read it back to plaintext — a raw
// SELECT-then-decrypt elsewhere would bypass the permission gate and the decrypt audit row. This
// scan walks the repo's shipping TypeScript and SQL source and asserts each registered protected
// column NAME appears only where it legitimately must: the chokepoint modules and field registry, the
// database schema, the migrations, and the explicitly allow-listed write/backfill sites that bind a
// value ALREADY sealed through the chokepoint into their own INSERT/UPDATE. A new raw reference
// anywhere else fails here, not in production. Test files are out of scope — they exercise the columns
// by design (asserting a value is sealed, that a decrypt audits) and never ship — so the scan covers
// production source only, the surface where a raw read would actually bypass the gate.
//
// Runs under the Node pool (this package's default), so node:fs reads the real source tree directly.

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

// Directories never worth scanning (build output, dependencies, VCS, and nested git worktrees —
// `.claude/worktrees/` holds checkouts of other branches whose duplicate source would be scanned as
// if it lived in this tree).
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  ".turbo",
  ".wrangler",
  // Generated build output: type-declaration/build dirs mirror the sanctioned schema source
  // (per-firm-schema.ts), so scanning them re-flags the protected column names their real
  // definition legitimately declares — a false positive that only appears once a build has run.
  ".tsbuild",
  ".svelte-kit",
  ".vite",
]);

// Sanctioned homes for a protected column name, by repo-relative path. The chokepoint modules and
// field registry read/write protected columns through the audited seam; the schema and migrations
// DEFINE the columns. Reference by full relative path so a rename surfaces here.
const CHOKEPOINT_FILES = new Set(
  [
    "packages/data-access/src/protected-fields.ts",
    "packages/data-access/src/protected-field-registry.ts",
    "packages/data-access/src/secret-statements.ts",
    "packages/data-access/src/integration-credential-statements.ts",
    "packages/database/src/per-firm-schema.ts",
    "packages/database/src/protected-columns.ts",
  ].map(normalizeRelative),
);

// Allow-listed write/backfill sites: each binds a value the chokepoint already sealed
// (composeProtectedWrite) into its own INSERT/UPDATE, or filters on the ciphertext column being
// NULL — neither reads a sealed value back to plaintext, so neither bypasses the audited decrypt.
// The decrypt of these columns happens ONLY through readProtected in the chokepoint modules above.
const ALLOW_LISTED_WRITE_SITES = new Set(
  [
    // The incident-intake route: seals the description through composeProtectedWrite, then binds the
    // returned ciphertext value into its INSERT — it never SELECTs the ciphertext to decrypt.
    "apps/api-worker/src/routes/incidents.ts",
    // The backfill sweep: seals pre-slice plaintext through the chokepoint, UPDATEs the ciphertext
    // column, and selects rows by `description_ciphertext IS NULL` — it never decrypts.
    "apps/api-worker/src/scheduled.ts",
    // The directory identifier write/match path: addIdentifier seals each typed identifier value
    // through composeProtectedWrite and binds the returned ciphertext + blind-index values into its
    // own INSERT; findByIdentifier filters on value_blind_index equality (no decrypt); the only
    // decrypt is readIdentifier delegating to readProtected. It never SELECTs the ciphertext to
    // decrypt outside the chokepoint.
    "packages/directory/src/identifiers.ts",
    // The load-profile harness (fixtures, never bundled into the Worker — not a production read
    // surface): the generator seals through composeProtectedWrite/putSecret and binds the returned
    // ciphertext into its INSERT, and the measurement layer fetches a ciphertext only to hand it to
    // readProtected/getSecret (the chokepoint does every decrypt) plus an EXPLAIN-only plan probe —
    // no raw decrypt bypasses the gate.
    "packages/fixtures/src/load-profile/protected-generate.ts",
    "packages/fixtures/src/load-profile/protected-measurements.ts",
    // The directory load-profile measurement harness (fixtures, never bundled into the Worker): same
    // shape as protected-measurements.ts for the directory_identifier column — it prefetches a page of
    // (id, value_ciphertext) pairs only to hand each to readProtected (the chokepoint does every
    // decrypt under the row-bound AAD), and EXPLAIN-probes the value_blind_index equality lookup. No
    // raw decrypt bypasses the gate.
    "packages/fixtures/src/load-profile/directory-measurements.ts",
    // The matter-asset identifier write/read pair: the statements module binds a value the service
    // already sealed through composeProtectedWrite into its own INSERT, and exposes exactly one
    // SELECT of the sealed column — whose only caller hands the row straight to readProtected, so the
    // permission gate and the audit row are inseparable from the decrypt. Every other read in that
    // package projects display_suffix, which is why the ordinary row shape has no field a full value
    // could ride on.
    "packages/matter-assets/src/identifier-statements.ts",
    "packages/matter-assets/src/identifier-service.ts",
  ].map(normalizeRelative),
);

// The migration tree DEFINES the protected columns (CREATE TABLE / ALTER / table-rebuild copy), so
// every file under it is sanctioned. Matched by path prefix rather than by name.
const MIGRATIONS_PREFIX = normalizeRelative("packages/database/drizzle");

function normalizeRelative(path: string): string {
  return path.split("/").join(sep);
}

// Collects shipping source: .ts and .sql files, excluding test files (*.test.ts) and anything under
// a test/ directory — test code references protected columns deliberately and never ships.
function listSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry) || entry === "test") continue;
      found.push(...listSourceFiles(absolute));
      continue;
    }
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".ts") || entry.endsWith(".sql")) found.push(absolute);
  }
  return found;
}

// A protected column name is "referenced" by a file when its distinctive token appears as a
// whole-word identifier. For `incident.description_ciphertext` the column name alone is distinctive.
// For `firm_secret.ciphertext` the bare word `ciphertext` is common (variable names, comments), so
// that column is matched only when the table name `firm_secret` and the column appear in the same
// file — every legitimate `firm_secret.ciphertext` reference is co-located with the table name.
function referencesColumn(source: string, table: string, column: string): boolean {
  const columnPattern = new RegExp(`\\b${column}\\b`);
  if (column === "ciphertext") {
    return new RegExp(`\\b${table}\\b`).test(source) && columnPattern.test(source);
  }
  return columnPattern.test(source);
}

describe("no protected column escapes the chokepoint (golden rule 3)", () => {
  const sourceFiles = listSourceFiles(REPO_ROOT);

  it("the scan actually walked the source tree and saw the chokepoint files", () => {
    // Non-vacuity floor: a regression that swept the tree to empty (or never resolved the protected
    // columns) would otherwise pass silently.
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(PROTECTED_COLUMNS.length).toBeGreaterThan(0);
    const relativePaths = new Set(sourceFiles.map((file) => relative(REPO_ROOT, file)));
    for (const sanctioned of CHOKEPOINT_FILES) {
      expect(relativePaths.has(sanctioned), `chokepoint file not found: ${sanctioned}`).toBe(true);
    }
  });

  it("every protected column is referenced only in chokepoint, schema, migration, or allow-listed files", () => {
    // Track that each protected column was actually found somewhere sanctioned — proves the scan is
    // checking real, present names rather than passing because nothing matched.
    const seenInSanctioned = new Map<string, boolean>(
      PROTECTED_COLUMNS.map((c) => [`${c.table}.${c.column}`, false]),
    );
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const relativePath = relative(REPO_ROOT, file);
      const source = readFileSync(file, "utf8");
      const isSanctioned =
        CHOKEPOINT_FILES.has(relativePath) ||
        ALLOW_LISTED_WRITE_SITES.has(relativePath) ||
        relativePath.startsWith(MIGRATIONS_PREFIX);

      for (const { table, column } of PROTECTED_COLUMNS) {
        if (!referencesColumn(source, table, column)) continue;
        const key = `${table}.${column}`;
        if (isSanctioned) {
          if (CHOKEPOINT_FILES.has(relativePath) || relativePath.startsWith(MIGRATIONS_PREFIX)) {
            seenInSanctioned.set(key, true);
          }
          continue;
        }
        offenders.push(`${relativePath}: references protected column ${key}`);
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
    // Each registered protected column must have been found in at least one sanctioned home — the
    // scan never silently skips a column whose name drifted out of the schema/chokepoint.
    for (const [key, seen] of seenInSanctioned) {
      expect(
        seen,
        `protected column ${key} was never found in a chokepoint/schema/migration file`,
      ).toBe(true);
    }
  });
});
