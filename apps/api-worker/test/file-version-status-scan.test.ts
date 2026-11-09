// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern): the quarantine gate is enforced by the
// data-access layer, so EVERY SELECT against file_version must carry a status predicate — a raw read
// without one could serve a pending or quarantined version. The worker routes go through the
// file-manager's status-gated queries and hold no raw file_version selects, so this scan is expected
// to pass clean; it stands guard so a future raw query added to a route fails here. A read that
// legitimately spans all statuses is allowlisted by an inline `fitness:allow-no-status` marker
// immediately above it. The twin scan over the file-manager package source lives beside that package.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so
// the sources are pulled in as raw text at build time (import.meta.glob with ?raw) — recursive across
// routes/, files/, and the package root by the glob itself. This is the worker's deviation from the
// file-manager twin, which reads its flat package directory directly under the Node environment.
// import.meta.glob is a Vite build-time macro: it inlines the matched files and MUST be referenced by
// its full literal name (Vite statically replaces the call), so it cannot be aliased. Its type is not
// in the worker's tsconfig lib, so the one macro shape this scan uses is declared here.
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

describe("file_version reads are status-gated (golden rule 3)", () => {
  it("no SELECT against file_version in the worker source omits a status predicate", () => {
    // Non-vacuity floor: the glob actually saw the worker source (a regression that swept the tree to
    // empty would otherwise pass silently).
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const { sql, index } of sqlLiterals(source)) {
        const touchesVersions = /file_version/i.test(sql) || /FILE_VERSION_TABLE/.test(sql);
        if (!touchesVersions || !/\bSELECT\b/.test(sql)) continue;
        if (/status/i.test(sql)) continue;
        const preceding = source.slice(Math.max(0, index - 240), index);
        if (preceding.includes("fitness:allow-no-status")) continue;
        offenders.push(`${file}: ${sql.slice(0, 80)}…`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
