import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern, time edition): time is WIP, NOT a ledger
// posting — unbilled time lives in its own store and never touches the double-entry ledger (the ledger
// stays purely money-movement; billable time converts to an A/R receivable only at billing). So no SQL
// literal in the timekeeping write path may name a ledger_* table. This scan stands guard so a future
// route or service that wrongly posts a time entry to the ledger fails here, not in production.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so the
// sources are pulled in as raw text at build time (import.meta.glob with ?raw). import.meta.glob is a
// Vite build-time macro: it inlines the matched files and MUST be referenced by its full literal name,
// so it cannot be aliased; its type is not in the worker's tsconfig lib, so the shape is declared here.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function sqlLiterals(source: string): string[] {
  const out: string[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push(match[1] ?? "");
  }
  return out;
}

describe("time is WIP, not a ledger posting", () => {
  it("no timekeeping/timer source composes a ledger_* statement", () => {
    // Non-vacuity floor: the glob saw the worker source.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      // Only the timekeeping write surface is in scope: the time-entry/timer/rate routes and the
      // timekeeping call-site. A future billing route that legitimately posts to the ledger is NOT here.
      const isTimekeepingSurface =
        /\/routes\/(time-entries|timer|rate-cards|utbms-codes|non-billable-categories|narrative-templates|my-day)\.ts$/.test(
          file,
        ) ||
        file.includes("/timer/") ||
        file.includes("/timekeeping/");
      if (!isTimekeepingSurface) continue;
      for (const sql of sqlLiterals(source)) {
        if (/\bledger_[a-z_]+\b/i.test(sql)) {
          offenders.push(`${file}: ${sql.slice(0, 80)}…`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
