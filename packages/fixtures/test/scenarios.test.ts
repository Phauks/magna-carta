import {
  inconsistentBalancesStatement,
  unbalancedEntriesStatement,
} from "@magna-carta/ledger/fitness";
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { seedDemoChartOfAccounts } from "../src/demo-chart-of-accounts.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";
import {
  boundsRejection,
  multiLineSettlement,
  retainerDeposit,
  trustCorrection,
} from "../src/scenarios.ts";

async function setup() {
  const local = createLocalPerFirmDatabase();
  const context = fixtureContext("scenario-test");
  const accounts = await seedDemoChartOfAccounts(local.database, context);
  return { ...local, context, accounts };
}

async function expectFitnessClean(database: Awaited<ReturnType<typeof setup>>["database"]) {
  expect((await unbalancedEntriesStatement(database).all()).results).toEqual([]);
  expect((await inconsistentBalancesStatement(database).all()).results).toEqual([]);
}

describe("named scenarios — short stories through the real write paths, assertions baked in", () => {
  it("retainerDeposit: trust bank and client subledger both grow by the deposit", async () => {
    const { database, context, accounts } = await setup();
    const result = await retainerDeposit(database, context, accounts);
    expect(result.entryId).toMatch(/^led_/);
    await expectFitnessClean(database);
  });

  it("trustCorrection: post + reverse restores both balances and links the pair", async () => {
    const { database, context, accounts } = await setup();
    const result = await trustCorrection(database, context, accounts);
    expect(result.reversalEntryId).toMatch(/^led_/);
    await expectFitnessClean(database);
  });

  it("boundsRejection: the overdraw batch fails whole and the ledger is untouched", async () => {
    const { database, context, accounts } = await setup();
    const result = await boundsRejection(database, context, accounts);
    expect(result.rejected).toBe(true);
    await expectFitnessClean(database);
  });

  it("multiLineSettlement: a 4-line balanced entry posts clean", async () => {
    const { database, context, accounts } = await setup();
    await multiLineSettlement(database, context, accounts);
    await expectFitnessClean(database);
  });
});
