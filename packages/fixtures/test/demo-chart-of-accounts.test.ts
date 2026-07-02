import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { DEMO_ACCOUNT_KEYS, seedDemoChartOfAccounts } from "../src/demo-chart-of-accounts.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

describe("demo chart of accounts (DEMO DATA — not the Phase-3 product chart)", () => {
  it("seeds through createAccount; trust children hang under Client Trust Liability", async () => {
    const { database } = createLocalPerFirmDatabase();
    const context = fixtureContext("demo-llp-1");
    const accounts = await seedDemoChartOfAccounts(database, context);
    for (const key of DEMO_ACCOUNT_KEYS) expect(accounts.has(key)).toBe(true);

    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account WHERE parent_account_id = ?1")
      .bind(accounts.get("clientTrustLiability"))
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(2); // Dana Smith + Marcus Webb demo client subledgers

    const balances = await database
      .prepare("SELECT COUNT(*) AS n FROM account_balance")
      .bind()
      .all<{ n: number }>();
    expect(balances.results[0]?.n).toBe(DEMO_ACCOUNT_KEYS.length); // every account got its row
  });

  it("is deterministic: same seed twice → identical account rows", async () => {
    const first = createLocalPerFirmDatabase();
    const second = createLocalPerFirmDatabase();
    await seedDemoChartOfAccounts(first.database, fixtureContext("demo-llp-1"));
    await seedDemoChartOfAccounts(second.database, fixtureContext("demo-llp-1"));
    const dump = (raw: typeof first.raw) =>
      raw.prepare("SELECT * FROM ledger_account ORDER BY id").all();
    expect(dump(first.raw)).toEqual(dump(second.raw));
  });
});

describe("aBalancedEntryInput — the primitive entry factory", () => {
  it("draws deterministically, balances by construction, and posts via the real write path", async () => {
    const a = fixtureContext("factory-test");
    const b = fixtureContext("factory-test");
    const { aBalancedEntryInput } = await import("../src/factories.ts");
    const { createAccount } = await import("@magna-carta/ledger/create-account");
    const { postEntry } = await import("@magna-carta/ledger/post-entry");
    const { assertLedgerFitness } = await import("@magna-carta/ledger/fitness");
    const { commitEffectBatch } = await import("@magna-carta/data-access/effect-batch");
    const { toMinor } = await import("@magna-carta/money/format");

    const { database } = createLocalPerFirmDatabase();
    const serviceOptions = { clock: a.clock, randomSource: a.randomSource };
    const bank = await createAccount(
      database,
      { name: "Bank", type: "asset", currency: "USD" },
      serviceOptions,
    );
    await commitEffectBatch(database, bank.effect, { now: () => a.clock.now() });
    const income = await createAccount(
      database,
      { name: "Fee Income", type: "income", currency: "USD" },
      serviceOptions,
    );
    await commitEffectBatch(database, income.effect, { now: () => a.clock.now() });

    const accountPair = { debitAccountId: bank.accountId, creditAccountId: income.accountId };
    const inputA = aBalancedEntryInput(a, accountPair);
    const inputB = aBalancedEntryInput(b, accountPair);
    expect(inputB.description).toBe(inputA.description); // seeded faker narrative
    expect(inputB.lines.map((line) => toMinor(line.amount))).toEqual(
      inputA.lines.map((line) => toMinor(line.amount)),
    );
    expect(toMinor(inputA.lines[0]!.amount)).toBe(toMinor(inputA.lines[1]!.amount)); // balanced

    const overridden = aBalancedEntryInput(a, {
      ...accountPair,
      amountMinor: 12345,
      description: "Fixed description",
    });
    expect(overridden.description).toBe("Fixed description");
    expect(toMinor(overridden.lines[0]!.amount)).toBe(12345);

    const posted = await postEntry(database, inputA, serviceOptions);
    await commitEffectBatch(database, posted.effect, { now: () => a.clock.now() });
    await assertLedgerFitness(database);
  });
});

describe("anAccountInput — the primitive account factory", () => {
  it("builds a plausible input deterministically; overrides win; commits via createAccount", async () => {
    const a = fixtureContext("factory-test");
    const b = fixtureContext("factory-test");
    const { anAccountInput } = await import("../src/factories.ts");
    expect(anAccountInput(a)).toEqual(anAccountInput(b)); // seeded faker name
    const overridden = anAccountInput(a, { name: "Escrow Holding", type: "liability" });
    expect(overridden).toMatchObject({
      name: "Escrow Holding",
      type: "liability",
      currency: "USD",
    });

    const { createAccount } = await import("@magna-carta/ledger/create-account");
    const { commitEffectBatch } = await import("@magna-carta/data-access/effect-batch");
    const { database } = createLocalPerFirmDatabase();
    const created = await createAccount(database, anAccountInput(a), {
      clock: a.clock,
      randomSource: a.randomSource,
    });
    await commitEffectBatch(database, created.effect, { now: () => a.clock.now() });
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account")
      .bind()
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });
});
