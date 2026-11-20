import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// Table-wide proofs of the payables invariants, each a read that returns the rows breaking it.
// An empty result is a pass. They are run by the package tests over seeded books and are cheap
// enough to run against a firm's database when a figure is in doubt.

// A bill's lines add up to the bill, and its balance row carries the same amount.
export function vendorBillTotalsDisagreeStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT v.id
       FROM vendor_bill v
       JOIN vendor_bill_balance b ON b.vendor_bill_id = v.id
      WHERE b.amount_minor <> v.amount_minor
         OR v.amount_minor <> (SELECT COALESCE(SUM(l.amount_minor), 0)
                                 FROM vendor_bill_line l WHERE l.vendor_bill_id = v.id)`,
  );
}

// What a bill's balance says was paid is what its payment rows add up to.
export function vendorBillPaidDisagreesStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT b.vendor_bill_id
       FROM vendor_bill_balance b
      WHERE b.paid_minor <> (SELECT COALESCE(SUM(p.amount_minor), 0)
                               FROM vendor_bill_payment p WHERE p.vendor_bill_id = b.vendor_bill_id)`,
  );
}

// Every bill has a balance row, so no bill is invisible to the open total.
export function vendorBillWithoutBalanceStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT v.id FROM vendor_bill v
      WHERE NOT EXISTS (SELECT 1 FROM vendor_bill_balance b WHERE b.vendor_bill_id = v.id)`,
  );
}

// No operating account is also a trust bank account: the two registrations never share a leaf.
export function operatingAccountIsTrustStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT o.id FROM operating_bank_account o
       JOIN trust_account t ON t.bank_ledger_account_id = o.ledger_account_id`,
  );
}

// A matter line's cost entry is on the same matter, for the same amount.
export function vendorBillCostDisagreesStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT l.id FROM vendor_bill_line l
       JOIN cost_entry c ON c.id = l.disbursement_entry_id
      WHERE c.matter_id <> l.matter_id OR c.amount_minor <> l.amount_minor
         OR c.disbursement_class <> l.disbursement_class`,
  );
}

export const PAYABLES_FITNESS_STATEMENTS = {
  vendorBillTotalsDisagree: vendorBillTotalsDisagreeStatement,
  vendorBillPaidDisagrees: vendorBillPaidDisagreesStatement,
  vendorBillWithoutBalance: vendorBillWithoutBalanceStatement,
  operatingAccountIsTrust: operatingAccountIsTrustStatement,
  vendorBillCostDisagrees: vendorBillCostDisagreesStatement,
} as const;
