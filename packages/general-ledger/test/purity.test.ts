import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A SOURCE SCAN. The ledger's rules (balanced entries, leaf-only postings, the balance row moving in
// the same batch as its lines) live in postEntry and reverseEntry; trust's rules live in the trust
// package. A statement written here that touched either set of tables directly would skip every
// one of those rules while all the behavioural tests still passed.

const SOURCE_DIRECTORY = new URL("../src/", import.meta.url).pathname;

function sources(): Array<{ path: string; text: string }> {
  return readdirSync(SOURCE_DIRECTORY)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => {
      const path = join(SOURCE_DIRECTORY, name);
      return { path, text: readFileSync(path, "utf8") };
    });
}

const LEDGER_WRITE =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(ledger_entry|ledger_line|account_balance)\b/i;
const TRUST_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?trust_\w+/i;

describe("the operating books write through the ledger and never into trust", () => {
  it("composes no ledger entry, line or balance statement of its own", () => {
    expect(
      sources()
        .filter(({ text }) => LEDGER_WRITE.test(text))
        .map(({ path }) => path),
    ).toEqual([]);
  });

  it("writes no trust table", () => {
    expect(
      sources()
        .filter(({ text }) => TRUST_WRITE.test(text))
        .map(({ path }) => path),
    ).toEqual([]);
  });
});
