import { DatabaseSync } from "node:sqlite";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { postEntry } from "../src/post-entry.ts";
import {
  insertAccountStatement,
  insertBalanceRowStatement,
  setAccountBoundsStatement,
} from "../src/statements.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = {
  now: () => "2026-06-09T15:00:00.000Z",
  today: () => "2026-06-09",
};

async function setup() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  const database: BatchDatabase = nodeSqliteBatchDatabase(raw);
  const trustBank = newIdentifier("ledgerAccount");
  const smith = newIdentifier("ledgerAccount");
  await database.batch([
    insertAccountStatement(database, {
      id: trustBank,
      name: "Trust Bank — IOLTA",
      type: "asset",
      currency: "USD",
      parentAccountId: null,
      createdAt: clock.now(),
    }),
    insertBalanceRowStatement(database, trustBank, clock.now()),
    insertAccountStatement(database, {
      id: smith,
      name: "Dana Smith",
      type: "liability",
      currency: "USD",
      parentAccountId: null,
      createdAt: clock.now(),
    }),
    insertBalanceRowStatement(database, smith, clock.now()),
  ]);
  return { database, trustBank, smith };
}

describe("postEntry — the posting write path (ADR-0072)", () => {
  it("commits entry + lines + balance updates + outbox row in one batch", async () => {
    const { database, trustBank, smith } = await setup();
    const { entryId, effect } = await postEntry(
      database,
      {
        description: "Retainer deposit — Dana Smith",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: trustBank, direction: "debit", amount: money(500000, USD) },
          { accountId: smith, direction: "credit", amount: money(500000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, effect, { now: () => clock.now() });

    const entry = (
      await database
        .prepare("SELECT * FROM ledger_entry WHERE id = ?1")
        .bind(entryId)
        .all<Record<string, unknown>>()
    ).results[0];
    expect(entry?.["recorded_at"]).toBe("2026-06-09T15:00:00.000Z");
    expect(entry?.["reverses_entry_id"]).toBeNull();

    const lines = (
      await database
        .prepare(
          "SELECT direction, amount_minor, line_index FROM ledger_line WHERE entry_id = ?1 ORDER BY line_index",
        )
        .bind(entryId)
        .all<{ direction: string; amount_minor: number; line_index: number }>()
    ).results;
    expect(lines).toEqual([
      { direction: "debit", amount_minor: 500000, line_index: 0 },
      { direction: "credit", amount_minor: 500000, line_index: 1 },
    ]);

    // Both balances grow by 500000 in normal-balance terms (debit-normal asset debited;
    // credit-normal liability credited).
    const balances = (
      await database
        .prepare("SELECT account_id, balance_minor FROM account_balance ORDER BY account_id")
        .bind()
        .all<{ account_id: string; balance_minor: number }>()
    ).results;
    expect(balances.map((row) => row.balance_minor)).toEqual([500000, 500000]);

    const outbox = (
      await database
        .prepare("SELECT topic, payload, aggregate_key, seq FROM outbox")
        .bind()
        .all<{ topic: string; payload: string; aggregate_key: string; seq: number }>()
    ).results;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.topic).toBe("ledger.entry.posted");
    expect(outbox[0]?.aggregate_key).toBe("ledger");
    expect(outbox[0]?.seq).toBe(0);
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toEqual({ entryId });
  });

  it("refuses an empty entry with the named code — not a snapshot-read programmer error", async () => {
    const { database } = await setup();
    await expect(
      postEntry(
        database,
        { description: "Empty", effectiveDate: "2026-06-09", lines: [] },
        { clock },
      ),
    ).rejects.toMatchObject({ name: "LedgerValidationError", code: "too-few-lines" });
  });

  it("aggregates per-account deltas exactly near the safe-integer limit", async () => {
    const { database, trustBank, smith } = await setup();
    // trustBank (debit-normal asset): debit (2^53 - 1), debit 2, credit 4 — true delta 2^53 - 3.
    // Float order-of-operations rounds the running sum to 2^53 - 4 and silently writes a wrong
    // balance; BigInt aggregation keeps it exact.
    const { effect } = await postEntry(
      database,
      {
        description: "Near-limit aggregation",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: trustBank, direction: "debit", amount: money(9007199254740991, USD) },
          { accountId: trustBank, direction: "debit", amount: money(2, USD) },
          { accountId: trustBank, direction: "credit", amount: money(4, USD) },
          { accountId: smith, direction: "credit", amount: money(9007199254740989, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, effect, { now: () => clock.now() });
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(trustBank)
      .all<{ balance_minor: number }>();
    expect(results[0]?.balance_minor).toBe(9007199254740989);
  });

  it("posts an entry touching more than 100 distinct accounts (snapshot load chunks under D1's cap)", async () => {
    const { database, smith } = await setup();
    const accountIds = Array.from({ length: 149 }, () => newIdentifier("ledgerAccount"));
    await database.batch(
      accountIds.flatMap((id, index) => [
        insertAccountStatement(database, {
          id,
          name: `Cost account ${index}`,
          type: "asset",
          currency: "USD",
          parentAccountId: null,
          createdAt: clock.now(),
        }),
        insertBalanceRowStatement(database, id, clock.now()),
      ]),
    );
    const { effect } = await postEntry(
      database,
      {
        description: "Wide allocation — 150 distinct accounts",
        effectiveDate: "2026-06-09",
        lines: [
          ...accountIds.map((id) => ({
            accountId: id,
            direction: "debit" as const,
            amount: money(100, USD),
          })),
          { accountId: smith, direction: "credit" as const, amount: money(14900, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, effect, { now: () => clock.now() });
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(smith)
      .all<{ balance_minor: number }>();
    expect(results[0]?.balance_minor).toBe(14900);
  });

  it("refuses an unbalanced entry before composing anything", async () => {
    const { database, trustBank, smith } = await setup();
    await expect(
      postEntry(
        database,
        {
          description: "Broken",
          effectiveDate: "2026-06-09",
          lines: [
            { accountId: trustBank, direction: "debit", amount: money(100, USD) },
            { accountId: smith, direction: "credit", amount: money(99, USD) },
          ],
        },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "unbalanced" });
  });

  it("aggregates deltas when one account appears on multiple lines", async () => {
    const { database, trustBank, smith } = await setup();
    const { effect } = await postEntry(
      database,
      {
        description: "Split deposit",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: trustBank, direction: "debit", amount: money(300, USD) },
          { accountId: trustBank, direction: "debit", amount: money(200, USD) },
          { accountId: smith, direction: "credit", amount: money(500, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, effect, { now: () => clock.now() });
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(trustBank)
      .all<{ balance_minor: number }>();
    expect(results[0]?.balance_minor).toBe(500); // one aggregated UPDATE, not two
  });

  it("a violated balance bound aborts the WHOLE posting batch (entry, lines, outbox)", async () => {
    const { database, trustBank, smith } = await setup();
    // Fund Smith with 1000, then bound at min 0.
    const funded = await postEntry(
      database,
      {
        description: "Deposit",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: trustBank, direction: "debit", amount: money(1000, USD) },
          { accountId: smith, direction: "credit", amount: money(1000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, funded.effect, { now: () => clock.now() });
    await database.batch([setAccountBoundsStatement(database, smith, 0, null, clock.now())]);

    // Overdraw: debit Smith 2000 (liability debited = balance falls to -1000 < 0).
    const overdraw = await postEntry(
      database,
      {
        description: "Disbursement too large",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: smith, direction: "debit", amount: money(2000, USD) },
          { accountId: trustBank, direction: "credit", amount: money(2000, USD) },
        ],
      },
      { clock },
    );
    await expect(
      commitEffectBatch(database, overdraw.effect, { now: () => clock.now() }),
    ).rejects.toThrow();

    // NOTHING from the failed batch landed.
    const entryCount = (
      await database.prepare("SELECT COUNT(*) AS n FROM ledger_entry").bind().all<{ n: number }>()
    ).results[0];
    expect(entryCount?.n).toBe(1);
    const outboxCount = (
      await database.prepare("SELECT COUNT(*) AS n FROM outbox").bind().all<{ n: number }>()
    ).results[0];
    expect(outboxCount?.n).toBe(1);
  });
});
