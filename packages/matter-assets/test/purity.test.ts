import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source scans that hold the boundaries this package's whole value rests on. A trigger catches a
// forbidden write at RUNTIME; these catch it at review, before a call site nobody has written yet
// reaches production.

const SOURCE = join(import.meta.dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

// Comments legitimately DESCRIBE the forbidden statements ("no UPDATE reaches this table"), so they
// are stripped before the scan or every explanation would trip its own guard.
function codeWithoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the valuation history is append-only in the source too", () => {
  // The database refuses an UPDATE or a DELETE naming this table. This scan means the refusal is
  // discovered at review rather than in production, and it covers a path somebody adds later.
  it("issues no UPDATE and no DELETE against matter_asset_valuation", () => {
    const offenders = sourceFiles(SOURCE).filter((path) =>
      /(UPDATE|DELETE\s+FROM)\s+(\$\{?MATTER_ASSET_VALUATION_TABLE\}?|matter_asset_valuation)/i.test(
        codeWithoutComments(path),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // An upsert onto the valuation table would be an in-place overwrite wearing an insert — exactly
  // what the replace-guard trigger exists to refuse, and exactly the thing that reads as harmless.
  it("issues no upsert or REPLACE against matter_asset_valuation", () => {
    const offenders = sourceFiles(SOURCE).filter((path) => {
      const code = codeWithoutComments(path);
      return (
        /INSERT\s+OR\s+REPLACE\s+INTO\s+(\$\{?MATTER_ASSET_VALUATION_TABLE\}?|matter_asset_valuation)/i.test(
          code,
        ) ||
        /INSERT\s+INTO\s+\$\{MATTER_ASSET_VALUATION_TABLE\}[\s\S]{0,400}?ON\s+CONFLICT/i.test(code)
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe("no current value, anywhere", () => {
  // Every amount a read returns travels with the as_of_date and basis it came from. An identifier
  // that promised a bare current value would be a second, undated answer to the question this whole
  // subsystem exists to date.
  it("declares no current-value identifier", () => {
    const offenders = sourceFiles(SOURCE).filter((path) =>
      /\b(currentValue|current_value|latestValue|latest_value|assetValue\b)/.test(
        codeWithoutComments(path),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("no plaintext identifier escapes", () => {
  // The sealed column has exactly one reader and it is the data-access chokepoint, which checks the
  // permission and writes the audit row before any plaintext exists. A second SELECT of the column
  // anywhere would be a read path with neither.
  it("names value_ciphertext only in the statements module and the service that seals it", () => {
    const offenders = sourceFiles(SOURCE)
      .filter((path) => codeWithoutComments(path).includes("value_ciphertext"))
      .map((path) => path.slice(SOURCE.length + 1).replace(/\\/g, "/"));
    expect(offenders.sort()).toEqual(["identifier-service.ts", "identifier-statements.ts"]);
  });

  // The register holds a client's most sensitive financial facts, so no service here calls out to
  // anything: no network, no clock of its own, no ambient identity.
  it("makes no network call and reads no ambient clock", () => {
    const offenders = sourceFiles(SOURCE).filter((path) =>
      /\bfetch\s*\(|\bDate\.now\s*\(|new\s+Date\s*\(\s*\)/.test(codeWithoutComments(path)),
    );
    expect(offenders).toEqual([]);
  });
});
