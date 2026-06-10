import {
  inconsistentBalancesStatement,
  unbalancedEntriesStatement,
} from "@magna-carta/ledger/fitness";
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { seedDemoFirm } from "../src/demo-firm.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

// Outbox `id` is minted unseeded inside data-access (the documented determinism seam — see the
// package CLAUDE.md): compare outbox rows without it; everything else byte-identical.
function dumpDeterministicState(raw: ReturnType<typeof createLocalPerFirmDatabase>["raw"]) {
  return {
    accounts: raw.prepare("SELECT * FROM ledger_account ORDER BY id").all(),
    entries: raw.prepare("SELECT * FROM ledger_entry ORDER BY id").all(),
    lines: raw.prepare("SELECT * FROM ledger_line ORDER BY id").all(),
    balances: raw.prepare("SELECT * FROM account_balance ORDER BY account_id").all(),
    outbox: raw
      .prepare(
        "SELECT topic, payload, aggregate_key, seq, status, attempts, created_at FROM outbox ORDER BY seq, created_at",
      )
      .all(),
  };
}

describe("seedDemoFirm — the demo bundle, deterministic by seed", () => {
  it("requires the explicit opt-in", async () => {
    const { database } = createLocalPerFirmDatabase();
    await expect(
      seedDemoFirm(database, fixtureContext("demo-llp-1"), { allowSeeding: false }),
    ).rejects.toThrow(/seeding/i);
  });

  it("seeds a coherent story and the fitness queries hold", async () => {
    const { database } = createLocalPerFirmDatabase();
    const summary = await seedDemoFirm(database, fixtureContext("demo-llp-1"), {
      allowSeeding: true,
    });
    expect(summary.entryCount).toBeGreaterThanOrEqual(12);
    expect((await unbalancedEntriesStatement(database).all()).results).toEqual([]);
    expect((await inconsistentBalancesStatement(database).all()).results).toEqual([]);
  });

  it("same seed → identical rows; different seed → different rows", async () => {
    const first = createLocalPerFirmDatabase();
    const second = createLocalPerFirmDatabase();
    const third = createLocalPerFirmDatabase();
    await seedDemoFirm(first.database, fixtureContext("demo-llp-1"), { allowSeeding: true });
    await seedDemoFirm(second.database, fixtureContext("demo-llp-1"), { allowSeeding: true });
    await seedDemoFirm(third.database, fixtureContext("demo-llp-2"), { allowSeeding: true });
    expect(dumpDeterministicState(first.raw)).toEqual(dumpDeterministicState(second.raw));
    expect(JSON.stringify(dumpDeterministicState(first.raw))).not.toBe(
      JSON.stringify(dumpDeterministicState(third.raw)),
    );
  });
});
