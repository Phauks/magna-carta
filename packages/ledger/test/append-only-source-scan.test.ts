import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The append-only invariant's source scan (design spec, Enforcement & fitness functions; the
// package CLAUDE.md invariant): no UPDATE or DELETE statement may target the immutable ledger
// tables anywhere in package source. Corrections are reversing entries, never mutations.
// Sanctioned today: UPDATE account_balance (the in-batch delta — ADR-0072). When the
// account-closing service ships, UPDATE ledger_account gains a sanctioned site and this scan is
// loosened DELIBERATELY, in the same commit.
const PACKAGES_DIRECTORY = join(import.meta.dirname, "..", "..");

// The builders interpolate exported constants (`UPDATE ${ACCOUNT_BALANCE_TABLE} …`), so each
// pattern matches BOTH the literal table name and its constant-interpolated form — a literal-only
// scan would wave through exactly the SQL this package actually writes.
const tableTarget = (tableName: string, constantName: string) =>
  `(?:\`?${tableName}\\b|\\$\\{${constantName}\\})`;

const IMMUTABLE_TABLES = [
  ["ledger_entry", "LEDGER_ENTRY_TABLE"],
  ["ledger_line", "LEDGER_LINE_TABLE"],
  ["ledger_account", "LEDGER_ACCOUNT_TABLE"],
] as const;

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  ...IMMUTABLE_TABLES.flatMap(([tableName, constantName]) => [
    {
      label: `UPDATE ${tableName}`,
      pattern: new RegExp(`\\bUPDATE\\s+${tableTarget(tableName, constantName)}`, "i"),
    },
    {
      label: `DELETE FROM ${tableName}`,
      pattern: new RegExp(`\\bDELETE\\s+FROM\\s+${tableTarget(tableName, constantName)}`, "i"),
    },
  ]),
  // account_balance: UPDATE is the sanctioned in-batch delta; DELETE is never sanctioned (the
  // balance row lives and dies with its account, and accounts are never deleted).
  {
    label: "DELETE FROM account_balance",
    pattern: new RegExp(
      `\\bDELETE\\s+FROM\\s+${tableTarget("account_balance", "ACCOUNT_BALANCE_TABLE")}`,
      "i",
    ),
  },
];

describe("append-only source scan (ADR-0072)", () => {
  it("the patterns catch literal, backticked, and constant-interpolated table names", () => {
    const offender = (sql: string) => FORBIDDEN.some(({ pattern }) => pattern.test(sql));
    expect(offender("UPDATE ledger_entry SET effective_date = ?1")).toBe(true);
    expect(offender("UPDATE `ledger_line` SET amount_minor = 0")).toBe(true);
    // eslint-disable-next-line no-template-curly-in-string
    expect(offender("UPDATE ${LEDGER_ENTRY_TABLE} SET recorded_at = ?1")).toBe(true);
    expect(offender("DELETE FROM ledger_line WHERE entry_id = ?1")).toBe(true);
    // eslint-disable-next-line no-template-curly-in-string
    expect(offender("DELETE FROM ${ACCOUNT_BALANCE_TABLE}")).toBe(true);
    // The sanctioned forms stay clean.
    // eslint-disable-next-line no-template-curly-in-string
    expect(offender("UPDATE ${ACCOUNT_BALANCE_TABLE} SET balance_minor = balance_minor + ?2")).toBe(
      false,
    );
    expect(
      offender("FOREIGN KEY (`entry_id`) REFERENCES `ledger_entry`(`id`) ON UPDATE no action"),
    ).toBe(false);
  });

  it("no package source issues UPDATE/DELETE against the immutable ledger tables", async () => {
    const packageNames = await readdir(PACKAGES_DIRECTORY);
    const offenders: string[] = [];
    for (const packageName of packageNames) {
      const sourceDirectory = join(PACKAGES_DIRECTORY, packageName, "src");
      let entries: string[];
      try {
        entries = (await readdir(sourceDirectory, { recursive: true })) as string[];
      } catch {
        continue; // not a package with a src directory
      }
      for (const entry of entries.filter((name) => name.endsWith(".ts"))) {
        const text = await readFile(join(sourceDirectory, entry), "utf8");
        for (const { label, pattern } of FORBIDDEN) {
          if (pattern.test(text)) offenders.push(`${packageName}/src/${entry}: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
