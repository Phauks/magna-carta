import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern): the quarantine gate is enforced by the
// data-access layer, so EVERY SELECT against file_version must carry a status predicate — a raw read
// without one could serve a pending or quarantined version. A read that legitimately spans all
// statuses (the next-version-number MAX) is allowlisted by an inline `fitness:allow-no-status` marker
// immediately above it. This scan runs over the package source so a future raw query fails here.

const SRC = join(import.meta.dirname, "..", "src");

function sqlLiterals(source: string): { sql: string; index: number }[] {
  const out: { sql: string; index: number }[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push({ sql: match[1] ?? "", index: match.index });
  }
  return out;
}

describe("file_version reads are status-gated (golden rule 3)", () => {
  it("no SELECT against file_version omits a status predicate", () => {
    const offenders: string[] = [];
    for (const fileName of readdirSync(SRC).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(SRC, fileName), "utf8");
      for (const { sql, index } of sqlLiterals(source)) {
        const touchesVersions = /file_version/i.test(sql) || /FILE_VERSION_TABLE/.test(sql);
        if (!touchesVersions || !/\bSELECT\b/.test(sql)) continue;
        if (/status/i.test(sql)) continue;
        const preceding = source.slice(Math.max(0, index - 240), index);
        if (preceding.includes("fitness:allow-no-status")) continue;
        offenders.push(`${fileName}: ${sql.slice(0, 80)}…`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
