import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fitness function: @magna-carta/reporting is a READ-ONLY package. It composes report shapes out of
// reads the domain packages already own, and it writes nothing — no ledger entry, no correction, no
// status, not even to its own tables, because it has none.
//
// "Nothing in a reporting surface should be able to write" has to be a property somebody can check
// rather than an intention, and this is the check. A report that could write would be a report that
// could adjust the books it is reporting on, which is the one thing an audit artifact must never be
// able to do — and the moment it can, the difference the report exists to surface is the difference
// it quietly removed.
//
// The one write in the whole surface is the CALLER'S: producing an artifact appends a production
// row, an outbox message, and a filed document version, all composed by the route and the queue
// consumer through the ordinary chokepoint. That is deliberately outside this package, which is why
// this scan can be absolute rather than carrying an exception.

const sourceRoot = join(import.meta.dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const files = sourceFiles(sourceRoot);

// Comments are stripped before every scan below: these modules describe at length the writes they
// deliberately do not perform and the aggregates they deliberately do not recompute, and a scan that
// read prose would fail on the very sentences explaining the rule.
const codeOf = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the reporting package stays pure and read-only", () => {
  it("has sources to check (the scan is not vacuous)", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    // And the scan really is looking at code that reaches into the domain packages — which is where
    // a composer would come from, and therefore the only direction the read-only rules below can be
    // broken from. Without this floor, a package whose sources had drifted to pure types would pass
    // every rule for the wrong reason.
    expect(files.some((file) => /from\s+"@magna-carta\//.test(codeOf(file)))).toBe(true);
  });

  const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
    ["Hono or an HTTP framework", /from\s+"hono/],
    ["zod request schemas", /from\s+"zod"/],
    ["Svelte", /from\s+"svelte/],
    ["Cloudflare Workers types", /D1Database|R2Bucket|DurableObject|\benv\./],
    ["a wall-clock read", /Date\.now\(\)|new Date\(\)/],
  ];

  // The one exception: src/contract.ts is the wire shape of the report responses, which the routes in
  // apps/api-worker build over. It parses no request and is imported by nothing else here, so zod
  // stays out of every module that reads or assembles (held by the test after this loop).
  const isContract = (file: string) => file === join(sourceRoot, "contract.ts");

  for (const [label, pattern] of forbidden) {
    it(`imports no ${label}`, () => {
      const offenders = files.filter(
        (file) =>
          !(label === "zod request schemas" && isContract(file)) &&
          pattern.test(readFileSync(file, "utf8")),
      );
      expect(offenders, `${label} reached ${offenders.join(", ")}`).toEqual([]);
    });
  }

  it("keeps the wire contract out of every module that reads or assembles", () => {
    const offenders = files.filter(
      (file) => !isContract(file) && /from\s+"[^"]*contract(\.ts)?"/.test(codeOf(file)),
    );
    expect(offenders, `the wire contract reached ${offenders.join(", ")}`).toEqual([]);
  });

  it("contains no INSERT, UPDATE, DELETE or REPLACE", () => {
    const offenders = files.filter((file) =>
      /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(codeOf(file)),
    );
    expect(offenders, `a write statement reached ${offenders.join(", ")}`).toEqual([]);
  });

  // The effect machinery, which is how anything is committed here. A package that cannot name a
  // write, an effect batch, or the commit that runs one cannot write however hard a call site tries.
  it("imports no effect-batch or commit machinery", () => {
    const offenders = files.filter((file) =>
      /\bEffectWrite\b|composeEffectBatch|commitEffectBatch|run-domain-effect|runIdempotentEffect|effect-batch/.test(
        codeOf(file),
      ),
    );
    expect(offenders, `effect machinery reached ${offenders.join(", ")}`).toEqual([]);
  });

  // The domain composers. Every one of these verbs names a function that produces a write in some
  // domain package; importing one into a report is how a read surface acquires the ability to change
  // what it is reporting.
  it("imports no domain composer", () => {
    const composerImport =
      /import\s*\{[^}]*\b(compose|issue|post|place|apply|open|close|finalize|record|reverse|write)[A-Z]\w*/;
    const offenders = files.filter((file) => composerImport.test(codeOf(file)));
    expect(offenders, `a domain composer reached ${offenders.join(", ")}`).toEqual([]);
  });

  // THE NO-SECOND-ANSWER REGRESSION. The client-ledger total under a trust account has exactly one
  // definition, in the trust package, and it is the one the three-way proof's client leg uses. A SUM
  // over ledger_line restricted to trust node accounts, written here, would be a second definition of
  // it — internally consistent, plausible, and free to disagree with the reconciliation a firm
  // attested to. The pack DECOMPOSES that total per matter leaf and proves the decomposition sums to
  // it (test/agreement.test.ts); it never re-derives the aggregate.
  it("computes no aggregate of its own over the ledger", () => {
    const offenders = files.filter((file) => {
      const source = codeOf(file);
      return (
        /\b(SUM|COUNT|AVG|TOTAL)\s*\(/i.test(source) &&
        /\b(ledger_line|LEDGER_LINE_TABLE|trust_ledger_node|TRUST_LEDGER_NODE_TABLE)\b/.test(source)
      );
    });
    expect(offenders, `an aggregate over the ledger reached ${offenders.join(", ")}`).toEqual([]);
  });
});
