import type { AccountType } from "@magna-carta/ledger/types";

// Where an account prints on a statement, as a refinement of its type. The DDL CHECK on
// ledger_account.statement_section holds the same table; this copy is what lets a service refuse
// by name before the database would refuse on a constraint name.
export const STATEMENT_SECTIONS = {
  asset: ["cash", "currentAssets", "fixedAssets", "otherAssets", "trustAssets"],
  liability: ["currentLiabilities", "longTermLiabilities", "clientTrustLiability"],
  equity: ["equity"],
  income: ["feeIncome", "otherIncome"],
  expense: ["costOfServices", "operatingExpenses", "otherExpenses"],
} as const satisfies Record<AccountType, readonly string[]>;

export type StatementSection = (typeof STATEMENT_SECTIONS)[AccountType][number];

export const ALL_STATEMENT_SECTIONS: readonly StatementSection[] = Object.values(
  STATEMENT_SECTIONS,
).flat();

// The two sections trust's own accounts are placed in. They are derived from trust's
// registration, never chosen: a firm cannot move its client trust liability into "other income".
export const TRUST_SECTIONS: ReadonlySet<StatementSection> = new Set([
  "trustAssets",
  "clientTrustLiability",
]);

export function isSectionOfType(type: AccountType, section: string): section is StatementSection {
  return (STATEMENT_SECTIONS[type] as readonly string[]).includes(section);
}
