import { describe, expect, it } from "vitest";
import BILLING_PACKAGE_SOURCES from "virtual:billing-package-sources";

// Fitness function: the WIP freeze contract for time AND costs. On entering billed/void a row's
// business columns freeze — the service refuses any UPDATE to a billed/void time_entry or cost_entry
// except the billing lock (invoice_id + the status the bill applies). This scan asserts no SQL literal
// in the timekeeping/costs/billing-core source UPDATEs a frozen time_entry/cost_entry WHERE status IN
// ('billed','void') beyond that lock. A statement that legitimately sets the billing lock — or carries
// the defense-in-depth NOT IN ('billed','void') freeze guard (which excludes frozen rows, not targets
// them) — is allowlisted by an inline `fitness:allow-billing-lock` marker above it.
//
// Package sources come in via a Vite plugin virtual module (virtual:billing-package-sources) — see
// billing-wip-ledger-fitness.test.ts for the full explanation of why import.meta.glob cannot resolve
// the package paths and how the virtual module is assembled.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const WORKER_SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

// The SQL statements the scan must police actually live in the timekeeping/costs/billing-core
// packages — the worker sources only hold the routes that call into them. Scanning only the worker
// sources is partially vacuous; include the package sources so the invariant is fully enforced.
const PACKAGE_SOURCES: Record<string, string> = BILLING_PACKAGE_SOURCES;

const SOURCES: Record<string, string> = { ...WORKER_SOURCES, ...PACKAGE_SOURCES };

function sqlLiterals(source: string): { sql: string; index: number }[] {
  const out: { sql: string; index: number }[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push({ sql: match[1] ?? "", index: match.index });
  }
  return out;
}

describe("a billed/void time_entry or cost_entry is frozen", () => {
  it("no statement UPDATEs a frozen time_entry/cost_entry WHERE status IN ('billed','void') beyond the billing lock", () => {
    // Non-vacuity floor: the glob saw the worker source.
    expect(Object.keys(WORKER_SOURCES).length).toBeGreaterThan(0);
    // Non-vacuity floors: each package's sources resolved through the virtual module. If Vite's
    // resolution changes and drops a package, this fails here rather than silently making the scan
    // vacuous for that package. billing-core is pure logic (no SQL today), but is floored so the
    // plugin is proven to serve it.
    const byPrefix = (prefix: string) =>
      Object.keys(PACKAGE_SOURCES).filter((key) => key.startsWith(prefix)).length;
    expect(byPrefix("packages/timekeeping/src")).toBeGreaterThan(0);
    expect(byPrefix("packages/costs/src")).toBeGreaterThan(0);
    expect(byPrefix("packages/billing-core/src")).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const { sql, index } of sqlLiterals(source)) {
        const touchesFrozenTable =
          /\b(time_entry|cost_entry)\b/.test(sql) || /TIME_ENTRY_TABLE|COST_ENTRY_TABLE/.test(sql);
        if (!touchesFrozenTable || !/\bUPDATE\b/i.test(sql)) continue;
        // The freeze is enforced by a WHERE guard that REFUSES billed/void (status NOT IN / status =
        // 'draft' …). A statement that TARGETS billed/void in its UPDATE filter is the dangerous shape.
        const targetsFrozen = /status\s+IN\s*\(\s*'billed'|status\s*=\s*'billed'|'void'/i.test(sql);
        if (!targetsFrozen) continue;
        const preceding = source.slice(Math.max(0, index - 240), index);
        if (preceding.includes("fitness:allow-billing-lock")) continue;
        offenders.push(`${file}: ${sql.slice(0, 80)}…`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
