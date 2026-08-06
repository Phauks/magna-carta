import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A SOURCE SCAN, not a behavioural test — because what it protects cannot be caught by one.
//
// Billing composes trust's transfer through `composeTrustToOperatingTransfer` and merges the
// statements it returns. The moment a file here writes its own `INSERT INTO trust_...` or builds its
// own trust ledger entry, every rule the trust package owns — the composition guard that refuses an
// entry mixing client money with anything outside it, the available-not-balance ceiling, one client
// per entry, the append-only discipline, the jurisdiction refusals — stops applying to that path,
// silently, while every existing test still passes. The second implementation would be correct on the
// day it was written and would drift from the first one afterwards.
//
// So the rule is enforced on the TEXT: this package may name trust tables in a SELECT (a read), and
// may not write one.

const SOURCE_DIRECTORY = new URL("../src/", import.meta.url).pathname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

// Any statement that would MODIFY a trust table. Reads are fine and are how the apply-funds path
// resolves a matter's leaf; writes are what belongs to @magna-carta/trust alone.
const TRUST_TABLE_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?trust_\w+/i;

describe("billing composes no trust statement of its own", () => {
  it("writes no trust table anywhere in the package", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SOURCE_DIRECTORY)) {
      if (TRUST_TABLE_WRITE.test(readFileSync(path, "utf8"))) offenders.push(path);
    }
    // A failure here is not a style problem: it means a trust rule is no longer being enforced on
    // whatever path that statement is on. Compose through @magna-carta/trust instead.
    expect(offenders).toEqual([]);
  });

  it("builds no trust ledger entry outside trust's own composers", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SOURCE_DIRECTORY)) {
      const source = readFileSync(path, "utf8");
      // `composeTrustEntry` is the door, and the guard rides inside it. A file importing it directly
      // would be building a trust entry here rather than asking trust to build one — which is the
      // same failure as the raw SQL above, one layer up.
      if (source.includes("composeTrustEntry") || source.includes("assertTrustComposition")) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
