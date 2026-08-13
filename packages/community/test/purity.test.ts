import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as controlPlaneSchema from "@magna-carta/database/control-plane-schema";
import * as perFirmSchema from "@magna-carta/database/per-firm-schema";
import { COMMUNITY_TABLES } from "../src/data-access/tables.ts";

// THE BOUNDARY, AS A TEST.
//
// This package is the platform's one deliberately cross-firm surface, and the argument for allowing
// it rests on three structural properties rather than on care. Two of them are asserted here; the
// third — that the worker serving the board holds no per-firm binding — is asserted in that
// worker's own suite, because it is a property of a deployment rather than of source.
//
// A change that breaks either of these does not produce a subtle bug. It produces a cross-firm
// surface that can read one firm's business data, which is the thing the whole arrangement exists
// to make impossible.

const sourceRoot = join(import.meta.dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts")) found.push(path);
  }
  return found;
}

const sources = sourceFiles(sourceRoot).map((path) => ({ path, text: readFileSync(path, "utf8") }));

// Import specifiers only. The prose in src/sql.ts names the firm-scoped layer in order to explain
// why it is not depended on, and a scan that cannot tell an explanation from a dependency would
// force that explanation out of the file it belongs in.
const IMPORT_SPECIFIER = /(?:from|import)\s+["']([^"']+)["']/g;

function importedModules(text: string): string[] {
  return [...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? "");
}

describe("the community package's isolation", () => {
  it("is not vacuous — it really is scanning this package's sources", () => {
    expect(sources.length).toBeGreaterThan(8);
    expect(sources.some((source) => source.path.endsWith("post-statements.ts"))).toBe(true);
  });

  it("never imports the firm-scoped data-access layer", () => {
    const offenders = sources.filter((source) =>
      importedModules(source.text).some((module) => module.startsWith("@magna-carta/data-access")),
    );
    expect(
      offenders.map((source) => source.path),
      "the firm-scoped data-access layer binds a query to exactly one firm; this package is " +
        "cross-firm by construction, so depending on it would make the board look like one more " +
        "firm-scoped consumer when it is the opposite. The SQL surface this package needs is " +
        "declared in src/sql.ts for exactly this reason.",
    ).toEqual([]);
  });

  it("never imports the per-firm schema, or any per-firm domain package", () => {
    const forbidden = [
      "per-firm-schema",
      "@magna-carta/matters",
      "@magna-carta/directory",
      "@magna-carta/trust",
      "@magna-carta/billing",
      "@magna-carta/file-manager",
      "@magna-carta/discovery",
      "@magna-carta/custodian",
      "@magna-carta/timekeeping",
      "@magna-carta/ledger",
    ];
    for (const source of sources) {
      const imported = importedModules(source.text);
      for (const module of forbidden) {
        expect(
          imported.some((specifier) => specifier.includes(module)),
          `${source.path} imports ${module}`,
        ).toBe(false);
      }
    }
  });

  it("writes only to community tables, and never names a per-firm table", () => {
    const perFirmTableNames = new Set<string>();
    for (const exported of Object.values(perFirmSchema)) {
      if (typeof exported !== "object" || exported === null) continue;
      try {
        perFirmTableNames.add(getTableConfig(exported as SQLiteTable).name);
      } catch {
        continue;
      }
    }
    // A per-firm table this package could plausibly want to read — a client's name, a matter
    // number — is the exact read that would turn a format-only detector into a cross-firm query.
    expect(perFirmTableNames.size).toBeGreaterThan(20);
    for (const source of sources) {
      for (const table of perFirmTableNames) {
        // Match the table only where SQL would name it, so a word like `matter` inside prose does
        // not trip the scan.
        const pattern = new RegExp(`(FROM|JOIN|INTO|UPDATE)\\s+\`?${table}\`?\\b`, "i");
        expect(pattern.test(source.text), `${source.path} runs SQL against ${table}`).toBe(false);
      }
    }
  });
});

describe("the tables this package names exist in the control-plane schema", () => {
  const controlPlaneTableNames = new Set<string>();
  for (const exported of Object.values(controlPlaneSchema)) {
    if (typeof exported !== "object" || exported === null) continue;
    try {
      controlPlaneTableNames.add(getTableConfig(exported as SQLiteTable).name);
    } catch {
      continue;
    }
  }

  it("names a real table for every constant", () => {
    for (const table of COMMUNITY_TABLES) {
      expect(controlPlaneTableNames.has(table), `${table} is not in the control-plane schema`).toBe(
        true,
      );
    }
  });

  it("covers every community table the schema declares, so none is orphaned", () => {
    const schemaCommunityTables = [...controlPlaneTableNames].filter((name) =>
      name.startsWith("community_"),
    );
    expect(schemaCommunityTables.sort()).toEqual([...COMMUNITY_TABLES].sort());
  });
});
