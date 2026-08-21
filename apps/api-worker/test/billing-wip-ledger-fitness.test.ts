import { describe, expect, it } from "vitest";
import BILLING_PACKAGE_SOURCES from "virtual:billing-package-sources";

// Fitness function (the append-only-source-scan pattern, billing edition): time AND costs are WIP, NOT
// ledger postings — unbilled work (time entries and disbursements) lives in its own store and never
// touches the double-entry ledger (the ledger stays purely money-movement; WIP converts to an A/R
// receivable only at billing). So no SQL literal in the timekeeping/costs/billing-core write path may
// name a ledger_* table. This scan stands guard so a future route or service that wrongly posts a time
// or cost entry to the ledger fails here, not in production.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so the
// sources are pulled in as raw text at build time. Worker sources use import.meta.glob with ?raw;
// package sources (where the actual SQL statement strings live) come in via a Vite plugin virtual
// module (virtual:billing-package-sources) because import.meta.glob cannot resolve paths outside the
// Vite root (apps/api-worker). The virtual module is assembled at build time by vitest.config.ts.
//
// import.meta.glob is a Vite build-time macro: it inlines the matched files and MUST be referenced by
// its full literal name, so it cannot be aliased; its type is not in the worker's tsconfig lib, so
// the shape is declared here.
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

function sqlLiterals(source: string): string[] {
  const out: string[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push(match[1] ?? "");
  }
  return out;
}

describe("time and costs are WIP, not ledger postings", () => {
  it("no timekeeping/costs/billing-core source composes a ledger_* statement", () => {
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
      // Only the billing write surface is in scope: the time-entry/timer/rate/costs routes and the
      // timekeeping/costs/billing-core call-sites. A future A/R route that legitimately posts to the
      // ledger is NOT here (A/R posting is a later slice).
      const isBillingSurface =
        /\/routes\/(time-entries|timer|rate-cards|utbms-codes|non-billable-categories|narrative-templates|my-day|costs)\.ts$/.test(
          file,
        ) ||
        file.includes("/timer/") ||
        file.includes("/timekeeping/") ||
        file.includes("/costs/") ||
        file.includes("/billing-core/");
      if (!isBillingSurface) continue;
      for (const sql of sqlLiterals(source)) {
        if (/\bledger_[a-z_]+\b/i.test(sql)) {
          offenders.push(`${file}: ${sql.slice(0, 80)}…`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
