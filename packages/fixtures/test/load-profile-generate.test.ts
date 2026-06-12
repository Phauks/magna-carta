import { assertLedgerFitness } from "@magna-carta/ledger/fitness";
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { generateLedgerVolume } from "../src/load-profile/generate.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

const TINY = scaleProfile(ledgerVolume, 0.002); // 50 entries, 3 subledgers — fast in CI

describe("load-profile generation", () => {
  it("refuses to run without the seeding opt-in", async () => {
    const local = createLocalPerFirmDatabase();
    await expect(
      generateLedgerVolume(local.database, fixtureContext("guard"), TINY, {
        allowSeeding: false,
      }),
    ).rejects.toThrow(/allowSeeding/);
  });

  it("generates the requested volume through the real write paths and passes fitness", async () => {
    const local = createLocalPerFirmDatabase();
    const result = await generateLedgerVolume(local.database, fixtureContext("volume"), TINY, {
      allowSeeding: true,
    });

    const { results: entryCountRows } = await local.database
      .prepare("SELECT COUNT(*) AS entry_count FROM ledger_entry")
      .all<{ entry_count: number }>();
    // entryCount archetype entries + the opening contribution + any reversals on top.
    expect(entryCountRows[0]!.entry_count).toBeGreaterThanOrEqual(TINY.entryCount + 1);
    expect(result.entryCount).toBe(entryCountRows[0]!.entry_count);

    // Probes point at real rows.
    expect(result.probes.busySubledgerAccountId).toMatch(/^acct_/);
    expect(result.probes.operatingBankAccountId).toMatch(/^acct_/);
    expect(result.probes.feeIncomeAccountId).toMatch(/^acct_/);
    expect(result.probes.sampleEntryId).toMatch(/^led_/); // the registry's ledgerEntry prefix

    // The whole generated book satisfies every table-wide ledger invariant.
    await assertLedgerFitness(local.database);

    // Trust subledgers were never overdrawn (the generator's realism tracking held).
    const { results: negativeTrust } = await local.database
      .prepare(
        `SELECT account_balance.account_id FROM account_balance
         JOIN ledger_account ON ledger_account.id = account_balance.account_id
         WHERE ledger_account.parent_account_id IS NOT NULL AND account_balance.balance_minor < 0`,
      )
      .all();
    expect(negativeTrust).toEqual([]);
  });

  it("is deterministic: the same seed produces identical business rows", async () => {
    const first = createLocalPerFirmDatabase();
    const second = createLocalPerFirmDatabase();
    await generateLedgerVolume(first.database, fixtureContext("twice"), TINY, {
      allowSeeding: true,
    });
    await generateLedgerVolume(second.database, fixtureContext("twice"), TINY, {
      allowSeeding: true,
    });
    // Business tables compare byte-identical. Outbox rows compare EXCLUDING id (minted unseeded
    // inside data-access — the documented seam, fixtures CLAUDE.md). account_balance keys on
    // account_id (no id column), so each table orders by its own primary key.
    const tables = [
      ["ledger_account", "id"],
      ["ledger_entry", "id"],
      ["ledger_line", "id"],
      ["account_balance", "account_id"],
    ] as const;
    for (const [table, orderColumn] of tables) {
      const rowsOf = (raw: typeof first.raw) =>
        raw.prepare(`SELECT * FROM ${table} ORDER BY ${orderColumn}`).all();
      expect(rowsOf(first.raw)).toEqual(rowsOf(second.raw));
    }
    const outboxOf = (raw: typeof first.raw) =>
      raw.prepare("SELECT topic, payload, aggregate_key, seq FROM outbox ORDER BY seq").all();
    expect(outboxOf(first.raw)).toEqual(outboxOf(second.raw));
  });
});
