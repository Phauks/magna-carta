import { describe, expect, it } from "vitest";

// Fitness function: the time-entry freeze contract. On entering billed/void a row's business columns
// freeze — the service refuses any UPDATE to a billed/void row except the billing lock (invoice_id + the
// status set the bill applies). This scan asserts no SQL literal in the timekeeping/billing source
// UPDATEs time_entry WHERE status IN ('billed','void') beyond that lock. A statement that legitimately
// sets the billing lock is allowlisted by an inline `fitness:allow-billing-lock` marker above it.
//
// (Same import.meta.glob raw-text mechanism as the WIP-ledger scan — see that file's note.)
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

function sqlLiterals(source: string): { sql: string; index: number }[] {
  const out: { sql: string; index: number }[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push({ sql: match[1] ?? "", index: match.index });
  }
  return out;
}

describe("a billed/void time_entry is frozen", () => {
  it("no statement UPDATEs time_entry WHERE status IN ('billed','void') beyond the billing lock", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const { sql, index } of sqlLiterals(source)) {
        const touchesTimeEntry = /\btime_entry\b/.test(sql) || /TIME_ENTRY_TABLE/.test(sql);
        if (!touchesTimeEntry || !/\bUPDATE\b/i.test(sql)) continue;
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
