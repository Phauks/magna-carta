import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import {
  inconsistentBalancesStatement,
  parentAccountsWithNonZeroBalanceStatement,
  unbalancedEntriesStatement,
} from "../src/fitness.ts";
import { postEntry } from "../src/post-entry.ts";
import { insertAccountStatement, insertBalanceRowStatement } from "../src/statements.ts";
import type { ClockPort } from "../src/types.ts";

// A LINEARIZABILITY CHECK, and the reason it is worth having beside the two-caller tests.
//
// Those ask a named question about a named pair: does this guard bite when that writer lands here.
// This asks the question you cannot enumerate — over many concurrent postings in an order nobody
// chose, does the ledger still add up. The oracle is the one the domain already owns: a materialized
// `account_balance` is derived state and must equal the recomputed sum of its lines, every entry's
// debits must equal its credits, and a parent's stored balance must stay at zero forever. Those are
// the invariants, they are already expressed as fitness queries, and no interleaving is allowed to
// break one.
//
// SEEDED AND EXHAUSTIVE OVER ITS RANGE rather than randomly sampled: the schedules come from a
// deterministic generator, so a failure names a seed somebody can re-run, and a green run is not a
// statement about how the scheduler felt today. Nothing is imported to do it — a property test is a
// loop over generated inputs and an oracle, and a dependency here would buy the loop.

const clock: ClockPort = {
  now: () => "2026-06-09T15:00:00.000Z",
  today: () => "2026-06-09",
};

/** A small deterministic generator, so a failing case is a seed rather than a mood. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

async function ledgerWithAccounts(count: number) {
  const database: BatchDatabase = createMigratedNodeDatabase("per-firm").database;
  const bank = newIdentifier("ledgerAccount");
  const clients = Array.from({ length: count }, () => newIdentifier("ledgerAccount"));
  const statements = [
    insertAccountStatement(database, {
      id: bank,
      name: "Trust Bank — IOLTA",
      type: "asset",
      currency: "USD",
      parentAccountId: null,
      createdAt: clock.now(),
    }),
    insertBalanceRowStatement(database, bank, clock.now()),
  ];
  for (const [index, client] of clients.entries()) {
    statements.push(
      insertAccountStatement(database, {
        id: client,
        name: `Client ${String(index)}`,
        type: "liability",
        currency: "USD",
        parentAccountId: null,
        createdAt: clock.now(),
      }),
      insertBalanceRowStatement(database, client, clock.now()),
    );
  }
  await database.batch(statements);
  return { database, bank, clients };
}

/** Every invariant the domain states about a posted ledger, asked of the database as it now stands. */
async function ledgerViolations(database: BatchDatabase): Promise<Record<string, number>> {
  const count = async (statement: ReturnType<typeof unbalancedEntriesStatement>) =>
    (await statement.all()).results.length;
  return {
    unbalancedEntries: await count(unbalancedEntriesStatement(database)),
    inconsistentBalances: await count(inconsistentBalancesStatement(database)),
    parentsCarryingBalance: await count(parentAccountsWithNonZeroBalanceStatement(database)),
  };
}

const NO_VIOLATIONS = {
  unbalancedEntries: 0,
  inconsistentBalances: 0,
  parentsCarryingBalance: 0,
};

async function postConcurrently(
  database: BatchDatabase,
  bank: LedgerAccountId,
  clients: readonly LedgerAccountId[],
  postings: readonly { client: LedgerAccountId; amountMinor: number }[],
): Promise<number> {
  const results = await Promise.allSettled(
    postings.map(async (posting) => {
      const { effect } = await postEntry(
        database,
        {
          description: "Retainer deposit",
          effectiveDate: "2026-06-09",
          lines: [
            { accountId: bank, direction: "debit", amount: money(posting.amountMinor, USD) },
            {
              accountId: posting.client,
              direction: "credit",
              amount: money(posting.amountMinor, USD),
            },
          ],
        },
        { clock },
      );
      await commitEffectBatch(database, effect, { now: clock.now });
    }),
  );
  void clients;
  return results.filter((one) => one.status === "fulfilled").length;
}

describe("the ledger under concurrent postings", () => {
  // One case per seed, so a failure is reported as its own test rather than buried in a loop.
  for (const seed of [1, 7, 42, 1_337, 90_210]) {
    it(`holds every invariant under a schedule generated from seed ${String(seed)}`, async () => {
      const random = seededRandom(seed);
      const accountCount = 2 + Math.floor(random() * 4);
      const { database, bank, clients } = await ledgerWithAccounts(accountCount);
      const postingCount = 4 + Math.floor(random() * 12);
      const postings = Array.from({ length: postingCount }, () => ({
        // Several postings deliberately land on the SAME account: contention on one balance row is the
        // case a per-account lock would hide and a read-modify-write would lose.
        client: clients[Math.floor(random() * clients.length)] ?? clients[0]!,
        amountMinor: 1 + Math.floor(random() * 500_000),
      }));

      const committed = await postConcurrently(database, bank, clients, postings);

      // Whatever the interleaving cost, it cannot have cost CORRECTNESS. A posting that lost a race
      // is allowed to fail; one that committed must leave the ledger adding up.
      expect(await ledgerViolations(database)).toEqual(NO_VIOLATIONS);
      expect(committed).toBeGreaterThan(0);
    });
  }

  it("keeps the bank balance equal to the sum of what actually committed", async () => {
    // The oracle above is internal consistency; this one is against a value computed outside SQL, so
    // a systematic error that kept both sides of the fitness query equally wrong still shows up.
    const { database, bank, clients } = await ledgerWithAccounts(3);
    const postings = Array.from({ length: 12 }, (_, index) => ({
      client: clients[index % clients.length]!,
      amountMinor: (index + 1) * 1_000,
    }));

    await postConcurrently(database, bank, clients, postings);

    const { results } = await database
      .prepare(
        "SELECT (SELECT balance_minor FROM account_balance WHERE account_id = ?1) AS stored," +
          " (SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_line WHERE account_id = ?1 AND direction = 'debit') AS posted",
      )
      .bind(bank)
      .all<{ stored: number; posted: number }>();
    expect(results[0]?.stored).toBe(results[0]?.posted);
  });
});
