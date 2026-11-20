import { describe, expect, it } from "vitest";
import type { OperatingBankAccountId } from "@magna-carta/identifiers/types";
import { PAYABLES_FITNESS_STATEMENTS } from "../src/fitness.ts";
import { GeneralLedgerValidationError } from "../src/general-ledger-validation.ts";
import {
  readOperatingBankAccounts,
  setDefaultOperatingBankAccount,
} from "../src/operating-accounts.ts";
import {
  readVendorBill,
  readVendorBillBoard,
  readVendorDefaultAccount,
} from "../src/vendor-bill-reads.ts";
import {
  payVendorBills,
  recordVendorBill,
  reverseVendorBill,
  setVendorDefaultAccount,
} from "../src/vendor-bills.ts";
import {
  accountId,
  balanceOf,
  booksFixture,
  commit,
  expectRefusal,
  options,
  seedMatter,
  type BooksFixture,
} from "./support.ts";

const ACCOUNTS_PAYABLE = "2000";
const CLIENT_COSTS_ADVANCED = "1300";
const POSTAGE = "6850";
const LEGAL_RESEARCH = "6300";

async function expectFitness(fixture: BooksFixture): Promise<void> {
  for (const [name, statement] of Object.entries(PAYABLES_FITNESS_STATEMENTS)) {
    const { results } = await statement(fixture.database).all();
    expect({ name, results }).toEqual({ name, results: [] });
  }
}

async function recordCourtReporterBill(fixture: BooksFixture) {
  const matterId = await seedMatter(fixture, "Smith v. Jones");
  const recorded = await recordVendorBill(
    fixture.database,
    {
      vendorId: "organization_courtReporter",
      billReference: "INV-1001",
      billDate: "2026-10-01",
      dueDate: "2026-10-31",
      lines: [
        {
          description: "Deposition transcript",
          amountMinor: 45_000,
          matterId,
          disbursementClass: "hard",
        },
        {
          description: "In-house copies",
          amountMinor: 2_500,
          matterId,
          disbursementClass: "soft",
          ledgerAccountId: accountId(fixture, POSTAGE),
        },
        {
          description: "Research database",
          amountMinor: 10_000,
          ledgerAccountId: accountId(fixture, LEGAL_RESEARCH),
        },
      ],
    },
    options,
  );
  await commit(fixture.database, recorded.effect);
  return { matterId, ...recorded };
}

describe("operating accounts", () => {
  it("makes the first account opened the default and lets the default move", async () => {
    const fixture = await booksFixture();
    const before = await readOperatingBankAccounts(fixture.database);
    expect(before.map((account) => [account.name, account.isDefault])).toEqual([
      ["Operating", true],
      ["Payroll", false],
    ]);
    await commit(
      fixture.database,
      await setDefaultOperatingBankAccount(fixture.database, fixture.payrollOperatingId, options),
    );
    const after = await readOperatingBankAccounts(fixture.database);
    expect(after.find((account) => account.isDefault)?.name).toBe("Payroll");
  });
});

describe("recording a vendor bill", () => {
  it("posts each line to its account against Accounts Payable and puts matter lines on the matter, approved", async () => {
    const fixture = await booksFixture();
    const { matterId, costEntryIds } = await recordCourtReporterBill(fixture);

    expect(await balanceOf(fixture, accountId(fixture, ACCOUNTS_PAYABLE))).toBe(57_500);
    expect(await balanceOf(fixture, accountId(fixture, CLIENT_COSTS_ADVANCED))).toBe(45_000);
    expect(await balanceOf(fixture, accountId(fixture, POSTAGE))).toBe(2_500);
    expect(await balanceOf(fixture, accountId(fixture, LEGAL_RESEARCH))).toBe(10_000);

    const { results: costs } = await fixture.database
      .prepare(
        "SELECT matter_id, amount_minor, disbursement_class, status FROM cost_entry ORDER BY amount_minor",
      )
      .all();
    expect(costs).toEqual([
      { matter_id: matterId, amount_minor: 2_500, disbursement_class: "soft", status: "approved" },
      { matter_id: matterId, amount_minor: 45_000, disbursement_class: "hard", status: "approved" },
    ]);
    expect(costEntryIds).toHaveLength(2);
    await expectFitness(fixture);
  });

  it("refuses a line on a matter that does not say hard or soft", async () => {
    const fixture = await booksFixture();
    const matterId = await seedMatter(fixture, "Doe matter");
    await expect(
      recordVendorBill(
        fixture.database,
        {
          vendorId: "organization_vendor",
          billDate: "2026-10-01",
          lines: [{ description: "Filing fee", amountMinor: 43_500, matterId }],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "vendor-bill-line-malformed" });
  });

  it("refuses a firm expense line posted to an account that is not an expense", async () => {
    const fixture = await booksFixture();
    await expect(
      recordVendorBill(
        fixture.database,
        {
          vendorId: "organization_vendor",
          billDate: "2026-10-01",
          lines: [
            {
              description: "Rent",
              amountMinor: 100_000,
              ledgerAccountId: fixture.trustBankLedgerAccountId,
            },
          ],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "account-is-trust-registered" });
  });
});

describe("paying vendor bills", () => {
  it("pays from any operating account, not only the default", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    const operatingLeaf = (await readOperatingBankAccounts(fixture.database)).find(
      (account) => account.operatingBankAccountId === fixture.payrollOperatingId,
    )?.ledgerAccountId;

    const paid = await payVendorBills(
      fixture.database,
      {
        operatingBankAccountId: fixture.payrollOperatingId,
        paidOn: "2026-11-02",
        method: "check",
        payments: [{ vendorBillId, amountMinor: 20_000 }],
      },
      options,
    );
    await commit(fixture.database, paid.effect);

    expect(await balanceOf(fixture, accountId(fixture, ACCOUNTS_PAYABLE))).toBe(37_500);
    expect(await balanceOf(fixture, operatingLeaf!)).toBe(-20_000);
    const detail = await readVendorBill(fixture.database, vendorBillId, "2026-11-20");
    expect(detail.state).toBe("partPaid");
    expect(detail.payments).toMatchObject([
      {
        operatingBankAccountName: "Payroll",
        method: "check",
        checkNumber: null,
        amountMinor: 20_000,
      },
    ]);
    await expectFitness(fixture);
  });

  it("never pays from trust: a trust account is not an operating account", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    await expect(
      payVendorBills(
        fixture.database,
        {
          operatingBankAccountId: fixture.trustAccountId as unknown as OperatingBankAccountId,
          paidOn: "2026-11-02",
          method: "bank_transfer",
          payments: [{ vendorBillId, amountMinor: 1_000 }],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "unknown-operating-account" });
  });

  it("refuses paying more than is left on a bill, and the balance bound holds if the check is bypassed", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    await expect(
      payVendorBills(
        fixture.database,
        {
          operatingBankAccountId: fixture.mainOperatingId,
          paidOn: "2026-11-02",
          method: "cash",
          payments: [{ vendorBillId, amountMinor: 57_501 }],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "payment-exceeds-open-balance" });

    // Two payments composed against the same open balance: the second commit must abort.
    const first = await payVendorBills(
      fixture.database,
      {
        operatingBankAccountId: fixture.mainOperatingId,
        paidOn: "2026-11-02",
        method: "cash",
        payments: [{ vendorBillId, amountMinor: 50_000 }],
      },
      options,
    );
    const second = await payVendorBills(
      fixture.database,
      {
        operatingBankAccountId: fixture.mainOperatingId,
        paidOn: "2026-11-02",
        method: "cash",
        payments: [{ vendorBillId, amountMinor: 50_000 }],
      },
      options,
    );
    await commit(fixture.database, first.effect);
    await expect(expectRefusal(() => commit(fixture.database, second.effect))).rejects.toThrow();
    await expectFitness(fixture);
  });

  it("carries a check number only on a check", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    await expect(
      payVendorBills(
        fixture.database,
        {
          operatingBankAccountId: fixture.mainOperatingId,
          paidOn: "2026-11-02",
          method: "card",
          payments: [{ vendorBillId, amountMinor: 1_000, checkNumber: 1001 }],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "check-number-malformed" });
  });
});

describe("reversing a vendor bill", () => {
  it("reverses the entry and voids the matter costs it made", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    await commit(
      fixture.database,
      await reverseVendorBill(
        fixture.database,
        { vendorBillId, reason: "Entered twice", reversedOn: "2026-11-03" },
        options,
      ),
    );
    expect(await balanceOf(fixture, accountId(fixture, ACCOUNTS_PAYABLE))).toBe(0);
    expect(await balanceOf(fixture, accountId(fixture, CLIENT_COSTS_ADVANCED))).toBe(0);
    const { results } = await fixture.database
      .prepare("SELECT DISTINCT status FROM cost_entry")
      .all<{ status: string }>();
    expect(results).toEqual([{ status: "void" }]);
    expect((await readVendorBill(fixture.database, vendorBillId, "2026-11-20")).state).toBe(
      "reversed",
    );
  });

  it("refuses a bill with payments, and the trigger holds it too", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    const reversal = await reverseVendorBill(
      fixture.database,
      { vendorBillId, reason: "Wrong vendor", reversedOn: "2026-11-03" },
      options,
    );
    const paid = await payVendorBills(
      fixture.database,
      {
        operatingBankAccountId: fixture.mainOperatingId,
        paidOn: "2026-11-02",
        method: "check",
        payments: [{ vendorBillId, amountMinor: 1_000 }],
      },
      options,
    );
    await commit(fixture.database, paid.effect);
    await expect(
      reverseVendorBill(
        fixture.database,
        { vendorBillId, reason: "Wrong vendor", reversedOn: "2026-11-03" },
        options,
      ),
    ).rejects.toBeInstanceOf(GeneralLedgerValidationError);
    await expect(expectRefusal(() => commit(fixture.database, reversal))).rejects.toThrow();
  });

  it("freezes the bill row itself", async () => {
    const fixture = await booksFixture();
    const { vendorBillId } = await recordCourtReporterBill(fixture);
    await expect(
      expectRefusal(() =>
        fixture.database
          .prepare("UPDATE vendor_bill SET memo = 'changed' WHERE id = ?1")
          .bind(vendorBillId)
          .run(),
      ),
    ).rejects.toThrow();
  });
});

describe("the Vendor Bills board", () => {
  it("groups bills by vendor with the open amount aged from the due date", async () => {
    const fixture = await booksFixture();
    await recordCourtReporterBill(fixture);
    const second = await recordVendorBill(
      fixture.database,
      {
        vendorId: "organization_landlord",
        billDate: "2026-11-15",
        dueDate: "2026-11-25",
        lines: [
          {
            description: "December rent",
            amountMinor: 300_000,
            ledgerAccountId: accountId(fixture, "6100"),
          },
        ],
      },
      options,
    );
    await commit(fixture.database, second.effect);

    const board = await readVendorBillBoard(fixture.database, {
      asOf: "2026-11-20",
      filter: "unpaid",
    });
    expect(board.totals).toEqual({
      openMinor: 357_500,
      overdueMinor: 57_500,
      dueThisWeekMinor: 300_000,
      openBillCount: 2,
    });
    const reporter = board.vendors.find(
      (vendor) => vendor.vendorId === "organization_courtReporter",
    );
    expect(reporter?.aging.days1To30).toBe(57_500);
    const landlord = board.vendors.find((vendor) => vendor.vendorId === "organization_landlord");
    expect(landlord?.aging.current).toBe(300_000);

    const paidOnly = await readVendorBillBoard(fixture.database, {
      asOf: "2026-11-20",
      filter: "paid",
    });
    expect(paidOnly.vendors).toEqual([]);
  });
});

describe("a vendor's default account", () => {
  it("is set, read and cleared, and only an expense account is accepted", async () => {
    const fixture = await booksFixture();
    await commit(
      fixture.database,
      await setVendorDefaultAccount(
        fixture.database,
        { vendorId: "organization_westlaw", ledgerAccountId: accountId(fixture, LEGAL_RESEARCH) },
        options,
      ),
    );
    expect(await readVendorDefaultAccount(fixture.database, "organization_westlaw")).toBe(
      accountId(fixture, LEGAL_RESEARCH),
    );
    await expect(
      setVendorDefaultAccount(
        fixture.database,
        { vendorId: "organization_westlaw", ledgerAccountId: accountId(fixture, ACCOUNTS_PAYABLE) },
        options,
      ),
    ).rejects.toMatchObject({ code: "vendor-bill-line-account-not-expense" });
    await commit(
      fixture.database,
      await setVendorDefaultAccount(
        fixture.database,
        { vendorId: "organization_westlaw", ledgerAccountId: null },
        options,
      ),
    );
    expect(await readVendorDefaultAccount(fixture.database, "organization_westlaw")).toBeNull();
  });
});
