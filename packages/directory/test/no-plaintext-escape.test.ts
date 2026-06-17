import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_COLUMNS } from "@magna-carta/database/protected-columns";

// Fitness function (the source-scan pattern, scoped to @magna-carta/directory): a sensitive identifier
// lives ONLY as ciphertext in directory_identifier.value_ciphertext, and its sibling index column
// directory_identifier.value_blind_index. The data-access protected() chokepoint is the only code that
// may read the ciphertext back to plaintext (permission-gated, audited); the directory package's one
// sanctioned home for BOTH columns is identifiers.ts — the write/match/read path that seals through
// composeProtectedWrite, matches by blind-index equality, and decrypts through readProtected. This scan
// walks the directory package's shipping source and asserts neither column name appears anywhere else
// in the package: a raw SELECT-then-decrypt in a route, a service, or a new module would bypass the
// permission gate and the decrypt audit, and fails here rather than in production.
//
// The repo-wide no-plaintext-escape scan (packages/data-access/test/no-plaintext-escape.test.ts) is the
// platform-wide enforcer over PROTECTED_COLUMNS; this is the directory-local companion that pins the
// directory package's one allow-listed chokepoint and proves the directory column is real and present.

const DIRECTORY_SRC = join(import.meta.dirname, "..", "src");

// The directory protected column from the platform registry — the one physical column every sensitive
// identifier seals into. value_blind_index is its derived equality index (not plaintext, but still
// confined to the same chokepoint so a stray reference cannot smuggle the search channel elsewhere).
const DIRECTORY_PROTECTED_COLUMN = "value_ciphertext";
const DIRECTORY_BLIND_INDEX_COLUMN = "value_blind_index";

// The one sanctioned home for the directory protected columns inside the directory package: the
// identifier write/match/read path. addIdentifier seals through composeProtectedWrite and binds the
// returned ciphertext + blind index into its own INSERT; findByIdentifier filters on value_blind_index
// equality (no decrypt); readIdentifier delegates the only decrypt to readProtected.
const DIRECTORY_CHOKEPOINT = "identifiers.ts";

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (entry === "test") continue;
      found.push(...listSourceFiles(absolute));
      continue;
    }
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".ts")) found.push(absolute);
  }
  return found;
}

// Strip line and block comments before scanning: the concern is CODE that touches the column (a raw
// SELECT/decrypt outside the chokepoint), not prose describing the design. A doc comment that names
// value_blind_index to explain the conflicts channel is not an escape.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function referencesColumn(source: string, column: string): boolean {
  return new RegExp(`\\b${column}\\b`).test(stripComments(source));
}

describe("no directory protected column escapes its chokepoint", () => {
  const sourceFiles = listSourceFiles(DIRECTORY_SRC);

  it("the scan walked the directory source and saw the chokepoint, and the column is registered", () => {
    // Non-vacuity floor: prove the scan saw real files including the chokepoint, and that the directory
    // column is actually in the platform registry (so a rename there surfaces here too).
    expect(sourceFiles.length).toBeGreaterThan(10);
    expect(sourceFiles.some((file) => file.endsWith(`${sep}${DIRECTORY_CHOKEPOINT}`))).toBe(true);
    expect(
      PROTECTED_COLUMNS.some(
        (c) => c.table === "directory_identifier" && c.column === DIRECTORY_PROTECTED_COLUMN,
      ),
      "directory_identifier.value_ciphertext must be a registered protected column",
    ).toBe(true);
  });

  it("value_ciphertext and value_blind_index appear only in identifiers.ts within the package", () => {
    const ciphertextSeenInChokepoint = { seen: false };
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const relativePath = relative(DIRECTORY_SRC, file);
      const isChokepoint = relativePath === DIRECTORY_CHOKEPOINT;
      const source = readFileSync(file, "utf8");

      for (const column of [DIRECTORY_PROTECTED_COLUMN, DIRECTORY_BLIND_INDEX_COLUMN]) {
        if (!referencesColumn(source, column)) continue;
        if (isChokepoint) {
          if (column === DIRECTORY_PROTECTED_COLUMN) ciphertextSeenInChokepoint.seen = true;
          continue;
        }
        offenders.push(`${relativePath}: references directory protected column ${column}`);
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
    // The ciphertext column must actually be present in the chokepoint — the scan never passes because
    // the name silently drifted out of identifiers.ts.
    expect(
      ciphertextSeenInChokepoint.seen,
      `${DIRECTORY_PROTECTED_COLUMN} was never found in ${DIRECTORY_CHOKEPOINT}`,
    ).toBe(true);
  });
});
