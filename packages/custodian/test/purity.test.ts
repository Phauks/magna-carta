import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fitness function: @magna-carta/custodian is a PURE domain package on the structure-versus-access
// seam. It composes statements and returns typed results; it never holds a database binding, reads a
// clock or an ambient identity, speaks HTTP, or touches the UI. The moment it does, a route becomes
// the only place the register's rules can be tested, and the rules stop being testable at all.

const sourceRoot = join(import.meta.dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const files = sourceFiles(sourceRoot);

describe("the custodian package stays pure", () => {
  it("has sources to check (the scan is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
    ["Hono or an HTTP framework", /from\s+"hono/],
    ["zod request schemas", /from\s+"zod"/],
    ["Svelte", /from\s+"svelte/],
    ["Cloudflare Workers types", /D1Database|R2Bucket|DurableObject|\benv\./],
    ["a wall-clock read", /Date\.now\(\)|new Date\(\)/],
  ];

  for (const [label, pattern] of forbidden) {
    it(`imports no ${label}`, () => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8")));
      expect(offenders, `${label} reached ${offenders.join(", ")}`).toEqual([]);
    });
  }

  // The append-only invariant, enforced over the source rather than only at the database: no code
  // path anywhere in this package may issue an UPDATE or DELETE naming custody_movement. The
  // triggers would abort it at runtime, which is the worst moment to find out.
  it("issues no UPDATE or DELETE against the movement ledger", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /(UPDATE|DELETE\s+FROM)\s+\$\{?CUSTODY_MOVEMENT_TABLE\}?|(UPDATE|DELETE\s+FROM)\s+custody_movement/i.test(
        source,
      );
    });
    expect(offenders, `a movement mutation reached ${offenders.join(", ")}`).toEqual([]);
  });

  // No retention defaults, ever. A platform default here is a platform OPINION about when to destroy
  // a client's irreplaceable property, and retention for client property is the single most
  // jurisdiction-bound fact in this subsystem.
  it("computes no retention period", () => {
    const offenders = files.filter((file) =>
      /retention(Until|Period|Months|Years)|DEFAULT_RETENTION/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders, `a retention default reached ${offenders.join(", ")}`).toEqual([]);
  });
});
