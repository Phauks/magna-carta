import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { EUR, money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/create-account.ts";
import { postEntry } from "../src/post-entry.ts";
import { reverseEntry } from "../src/reverse-entry.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = { now: () => "2026-06-09T15:00:00.000Z", today: () => "2026-06-09" };
const now = () => clock.now();

async function setupWithPostedEntry() {
  // Typed as the data-access BatchDatabase so the tests exercise the REAL D1-shaped surface.
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  const bank = await createAccount(
    database,
    { name: "Trust Bank", type: "asset", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(database, bank.effect, { now });
  const smith = await createAccount(
    database,
    { name: "Dana Smith", type: "liability", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(database, smith.effect, { now });
  const posted = await postEntry(
    database,
    {
      description: "Deposit posted to the wrong client",
      effectiveDate: "2026-06-08",
      lines: [
        { accountId: bank.accountId, direction: "debit", amount: money(500000, USD) },
        { accountId: smith.accountId, direction: "credit", amount: money(500000, USD) },
      ],
    },
    { clock },
  );
  await commitEffectBatch(database, posted.effect, { now });
  return { database, bank: bank.accountId, smith: smith.accountId, originalId: posted.entryId };
}

describe("reverseEntry — first-class corrections (ADR-0072)", () => {
  it("posts the exact mirror, links it, and balances return to zero", async () => {
    const { database, originalId } = await setupWithPostedEntry();
    const reversal = await reverseEntry(
      database,
      { entryId: originalId, description: "Correction: wrong client", effectiveDate: "2026-06-09" },
      { clock },
    );
    await commitEffectBatch(database, reversal.effect, { now });

    const link = (
      await database
        .prepare("SELECT reverses_entry_id FROM ledger_entry WHERE id = ?1")
        .bind(reversal.entryId)
        .all<{ reverses_entry_id: string }>()
    ).results[0];
    expect(link?.reverses_entry_id).toBe(originalId);

    const mirroredLines = (
      await database
        .prepare(
          "SELECT direction, amount_minor FROM ledger_line WHERE entry_id = ?1 ORDER BY line_index",
        )
        .bind(reversal.entryId)
        .all<{ direction: string; amount_minor: number }>()
    ).results;
    expect(mirroredLines).toEqual([
      { direction: "credit", amount_minor: 500000 }, // original debit, flipped
      { direction: "debit", amount_minor: 500000 },
    ]);

    const balances = (
      await database
        .prepare("SELECT balance_minor FROM account_balance")
        .bind()
        .all<{ balance_minor: number }>()
    ).results;
    expect(balances.every((row) => row.balance_minor === 0)).toBe(true);

    // The outbox payload for a reversal names BOTH ids (ids only — ADR-0038).
    const outbox = (
      await database
        .prepare("SELECT payload FROM outbox ORDER BY seq DESC LIMIT 1")
        .bind()
        .all<{ payload: string }>()
    ).results;
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toEqual({
      entryId: reversal.entryId,
      reversesEntryId: originalId,
    });
  });

  it("refuses to reverse twice (polite pre-check) and the UNIQUE survives a race", async () => {
    const { database, originalId } = await setupWithPostedEntry();
    const first = await reverseEntry(
      database,
      { entryId: originalId, description: "Correction", effectiveDate: "2026-06-09" },
      { clock },
    );
    // Compose a SECOND reversal BEFORE the first commits — both passed the pre-check (the race).
    const second = await reverseEntry(
      database,
      { entryId: originalId, description: "Concurrent correction", effectiveDate: "2026-06-09" },
      { clock },
    );
    await commitEffectBatch(database, first.effect, { now });
    // The loser's WHOLE batch fails on the UNIQUE — schema-level double-reversal defense.
    await expect(commitEffectBatch(database, second.effect, { now })).rejects.toThrow(/UNIQUE/);
    // And after commit, the pre-check refuses politely.
    await expect(
      reverseEntry(
        database,
        { entryId: originalId, description: "Again", effectiveDate: "2026-06-09" },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "already-reversed" });
  });

  it("refuses an unknown entry", async () => {
    const { database } = await setupWithPostedEntry();
    await expect(
      reverseEntry(
        database,
        {
          entryId: "led_doesnotexist00000000" as never,
          description: "x",
          effectiveDate: "2026-06-09",
        },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "unknown-entry" });
  });

  it("reversing a reversal is allowed (re-instates the original)", async () => {
    const { database, smith, originalId } = await setupWithPostedEntry();
    const reversal = await reverseEntry(
      database,
      { entryId: originalId, description: "Correction", effectiveDate: "2026-06-09" },
      { clock },
    );
    await commitEffectBatch(database, reversal.effect, { now });
    const reinstate = await reverseEntry(
      database,
      {
        entryId: reversal.entryId,
        description: "Un-correct: the original was right",
        effectiveDate: "2026-06-09",
      },
      { clock },
    );
    await commitEffectBatch(database, reinstate.effect, { now });
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(smith)
      .all<{ balance_minor: number }>();
    expect(results[0]?.balance_minor).toBe(500000); // back to the original state
  });

  it("a reversal violating a balance bound is refused at COMMIT, not by reverseEntry itself", async () => {
    // The production trust scenario (ADR-0009): deposit received, funds disbursed, then someone
    // attempts to reverse the original deposit — that would overdraw the client's trust ledger.
    const { database, bank, smith, originalId } = await setupWithPostedEntry();
    const { setAccountBoundsStatement } = await import("../src/statements.ts");
    await database.batch([setAccountBoundsStatement(database, smith, 0, null, clock.now())]);
    // Disburse the full deposit: Smith's subledger drops to 0.
    const disbursed = await postEntry(
      database,
      {
        description: "Disbursement to client",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: smith, direction: "debit", amount: money(500000, USD) },
          { accountId: bank, direction: "credit", amount: money(500000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, disbursed.effect, { now });
    // reverseEntry composes successfully (structural invariants hold)…
    const reversal = await reverseEntry(
      database,
      { entryId: originalId, description: "Reverse the deposit", effectiveDate: "2026-06-09" },
      { clock },
    );
    // …but the commit refuses: the mirror would take Smith to -500000 < min 0.
    await expect(commitEffectBatch(database, reversal.effect, { now })).rejects.toThrow(
      /CHECK|account_balance_bounds_check/,
    );
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(smith)
      .all<{ balance_minor: number }>();
    expect(results[0]?.balance_minor).toBe(0); // untouched — the whole batch rolled back
  });

  it("reverses an entry in any registered currency — EUR entries are correctable too", async () => {
    const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
    const bank = await createAccount(
      database,
      { name: "EUR Bank", type: "asset", currency: "EUR" },
      { clock },
    );
    await commitEffectBatch(database, bank.effect, { now });
    const client = await createAccount(
      database,
      { name: "EUR Client", type: "liability", currency: "EUR" },
      { clock },
    );
    await commitEffectBatch(database, client.effect, { now });
    const posted = await postEntry(
      database,
      {
        description: "EUR deposit",
        effectiveDate: "2026-06-08",
        lines: [
          { accountId: bank.accountId, direction: "debit", amount: money(500000, EUR) },
          { accountId: client.accountId, direction: "credit", amount: money(500000, EUR) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, posted.effect, { now });
    // The mirror must carry the account's own currency, not a hardcoded USD.
    const reversal = await reverseEntry(
      database,
      { entryId: posted.entryId, description: "Correction", effectiveDate: "2026-06-09" },
      { clock },
    );
    await commitEffectBatch(database, reversal.effect, { now });
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance")
      .bind()
      .all<{ balance_minor: number }>();
    expect(results.every((row) => row.balance_minor === 0)).toBe(true);
  });

  it("the future-dating guard applies to the reversal's own effective date", async () => {
    const { database, originalId } = await setupWithPostedEntry();
    await expect(
      reverseEntry(
        database,
        { entryId: originalId, description: "Backdated wrong", effectiveDate: "2026-06-10" },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "future-effective-date" });
  });
});
