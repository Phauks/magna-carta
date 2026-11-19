import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { TrustBankReconciliationId, UserId } from "@magna-carta/identifiers/types";
import type { ClockPort } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import {
  composeTrustBankReconciliationEdits,
  composeTrustBankReconciliationFinish,
  composeTrustBankReconciliationInterest,
  composeTrustBankReconciliationNote,
  composeTrustBankReconciliationRestore,
  composeTrustBankReconciliationRevert,
  composeTrustBankReconciliationSave,
  composeTrustBankReconciliationStart,
  linesNeedingReview,
  readNextBankReconciliationStart,
  readTrustBankReconciliation,
  readTrustBankReconciliations,
  undoRedoTargets,
} from "../src/bank-reconciliation.ts";
import { composeTrustDeposit, composeTrustDisbursement } from "../src/movements.ts";
import { commit, expectRefusal, seedMatter, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);
const MARCO = "user_marco" as UserId;
const ELEANOR = "user_eleanor" as UserId;

let instant = Date.parse("2026-10-20T15:00:00.000Z");
const clock: ClockPort = {
  now: () => {
    instant += 1_000;
    return new Date(instant).toISOString();
  },
  today: () => "2026-11-30",
};
const options = { clock };

async function setup() {
  const fixture = await trustFixture({ jurisdiction: "US-NV" });
  const matterId = await seedMatter(fixture, "Harrington", "entity_harrington");
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: {
        matterId: matterId as never,
        clientNodeName: "Trust, Harrington",
        matterLeafName: `Trust, Harrington, ${matterId}`,
      },
      amount: usd(2_500_000),
      effectiveDate: "2026-10-16",
      description: "Closing funds received",
      method: "check",
      reference: "2207",
      source: "Harrington Holdings",
      purpose: "Closing funds",
      recordedBy: MARCO,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  const node = await loadMatterTrustLeaf(
    fixture.database,
    fixture.trustAccountId,
    matterId as never,
  );
  const pay = async (amountMinor: number, payee: string, effectiveDate: string) => {
    const paid = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(amountMinor),
        effectiveDate,
        description: `Paid ${payee}`,
        method: "wire",
        reference: null,
        payee,
        purpose: "Closing costs",
        recordedBy: MARCO,
        authorizedBy: ELEANOR,
      },
      options,
    );
    await commit(fixture.database, paid.effect);
  };
  await pay(480_000, "Nevada Escrow Inc.", "2026-10-17");
  return { database: fixture.database as BatchDatabase, accountId: fixture.trustAccountId, pay };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function start(s: Setup, endBalanceMinor: number | null = 2_020_000) {
  const started = await composeTrustBankReconciliationStart(
    s.database,
    {
      trustAccountId: s.accountId,
      startDate: "2026-10-16",
      startBalanceMinor: 0,
      endDate: "2026-10-31",
      endBalanceMinor,
      startedBy: MARCO,
    },
    options,
  );
  await commit(s.database, started.effect);
  return started.reconciliationId;
}

async function tickAll(s: Setup, id: TrustBankReconciliationId, by: UserId = MARCO) {
  const detail = await readTrustBankReconciliation(s.database, id);
  const edits = detail.items.map((item) => ({
    kind: "tick" as const,
    line: { kind: "entry" as const, entryId: item.entryId },
    cleared: true,
  }));
  await commit(
    s.database,
    (await composeTrustBankReconciliationEdits(s.database, id, edits, by, options)).effect,
  );
}

describe("starting a reconciliation", () => {
  it("needs the start date and balance on an account's first one", async () => {
    const s = await setup();
    await expect(
      composeTrustBankReconciliationStart(
        s.database,
        { trustAccountId: s.accountId, endDate: "2026-10-31", startedBy: MARCO },
        options,
      ),
    ).rejects.toMatchObject({ code: "bank-reconciliation-start-required" });
  });

  it("lists every book item up to the end date, none ticked", async () => {
    const s = await setup();
    const id = await start(s);
    const detail = await readTrustBankReconciliation(s.database, id);
    expect(detail.items.map((item) => [item.amountMinor, item.type, item.cleared])).toEqual([
      [2_500_000, "check", false],
      [-480_000, "wire", false],
    ]);
    expect(detail.items[0]?.number).toBe("2207");
    expect(detail.items[1]?.payeeOrFrom).toBe("Nevada Escrow Inc.");
    expect(detail.figures.differenceMinor).toBe(2_020_000);
  });

  it("allows one reconciliation in progress per account", async () => {
    const s = await setup();
    await start(s);
    await expect(start(s)).rejects.toMatchObject({ code: "bank-reconciliation-in-progress" });
  });
});

describe("ticking", () => {
  it("adds cleared items into the cleared balance and the difference", async () => {
    const s = await setup();
    const id = await start(s);
    await tickAll(s, id);
    const detail = await readTrustBankReconciliation(s.database, id);
    expect(detail.figures).toMatchObject({
      depositedMinor: 2_500_000,
      withdrawnMinor: 480_000,
      clearedBalanceMinor: 2_020_000,
      differenceMinor: 0,
      depositClearedCount: 1,
      withdrawalClearedCount: 1,
    });
  });

  it("shows an item recorded after the start as new, and does not lock the account", async () => {
    const s = await setup();
    const id = await start(s);
    await s.pay(125_000, "Reno Courier LLC", "2026-10-22");
    const detail = await readTrustBankReconciliation(s.database, id);
    expect(detail.items.find((item) => item.payeeOrFrom === "Reno Courier LLC")?.isNew).toBe(true);
    expect(detail.items.find((item) => item.payeeOrFrom === "Nevada Escrow Inc.")?.isNew).toBe(
      false,
    );
  });

  it("numbers the changes of two people working at once in one order", async () => {
    const s = await setup();
    const id = await start(s);
    const detail = await readTrustBankReconciliation(s.database, id);
    const [first, second] = detail.items;
    const marco = await composeTrustBankReconciliationEdits(
      s.database,
      id,
      [{ kind: "tick", line: { kind: "entry", entryId: first!.entryId }, cleared: true }],
      MARCO,
      options,
    );
    const eleanor = await composeTrustBankReconciliationEdits(
      s.database,
      id,
      [{ kind: "tick", line: { kind: "entry", entryId: second!.entryId }, cleared: true }],
      ELEANOR,
      options,
    );
    await commit(s.database, marco.effect);
    await commit(s.database, eleanor.effect);
    const after = await readTrustBankReconciliation(s.database, id);
    expect(after.changes.map((change) => change.sequence)).toEqual([1, 2, 3, 4]);
    expect(after.items.every((item) => item.cleared)).toBe(true);
  });
});

describe("undo, redo and history", () => {
  it("undoes and redoes your own last change only", async () => {
    const s = await setup();
    const id = await start(s);
    const detail = await readTrustBankReconciliation(s.database, id);
    const line = { kind: "entry" as const, entryId: detail.items[0]!.entryId };
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationEdits(
          s.database,
          id,
          [{ kind: "tick", line, cleared: true }],
          MARCO,
          options,
        )
      ).effect,
    );
    // Eleanor has nothing of her own to undo.
    await expect(
      composeTrustBankReconciliationRevert(s.database, id, { kind: "undo" }, ELEANOR, options),
    ).rejects.toMatchObject({ code: "bank-reconciliation-nothing-to-revert" });

    await commit(
      s.database,
      (await composeTrustBankReconciliationRevert(s.database, id, { kind: "undo" }, MARCO, options))
        .effect,
    );
    let after = await readTrustBankReconciliation(s.database, id);
    expect(after.items[0]?.cleared).toBe(false);
    expect(undoRedoTargets(after.changes, MARCO).redo).not.toBeNull();

    await commit(
      s.database,
      (await composeTrustBankReconciliationRevert(s.database, id, { kind: "redo" }, MARCO, options))
        .effect,
    );
    after = await readTrustBankReconciliation(s.database, id);
    expect(after.items[0]?.cleared).toBe(true);
    expect(undoRedoTargets(after.changes, MARCO).redo).toBeNull();
  });

  it("puts back the end balance a change replaced", async () => {
    const s = await setup();
    const id = await start(s, 1_000);
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationEdits(
          s.database,
          id,
          [{ kind: "end_balance", endBalanceMinor: 2_020_000 }],
          ELEANOR,
          options,
        )
      ).effect,
    );
    const detail = await readTrustBankReconciliation(s.database, id);
    const change = detail.changes.at(-1)!;
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationRevert(
          s.database,
          id,
          { kind: "history", changeId: change.id },
          MARCO,
          options,
        )
      ).effect,
    );
    expect((await readTrustBankReconciliation(s.database, id)).endBalanceMinor).toBe(1_000);
  });

  it("cannot undo the end date the reconciliation was started with", async () => {
    const s = await setup();
    const id = await start(s, null);
    await expect(
      composeTrustBankReconciliationRevert(s.database, id, { kind: "undo" }, MARCO, options),
    ).rejects.toMatchObject({ code: "bank-reconciliation-nothing-to-revert" });
  });
});

describe("restore points", () => {
  it("restores ticks, end date and end balance, and saves the place first", async () => {
    const s = await setup();
    const id = await start(s);
    const saved = await composeTrustBankReconciliationSave(
      s.database,
      id,
      "Before checks",
      MARCO,
      options,
    );
    await commit(s.database, saved.effect);
    await tickAll(s, id);
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationEdits(
          s.database,
          id,
          [{ kind: "end_date", endDate: "2026-10-30" }],
          MARCO,
          options,
        )
      ).effect,
    );
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationRestore(
          s.database,
          id,
          saved.restorePointId,
          ELEANOR,
          options,
        )
      ).effect,
    );
    const detail = await readTrustBankReconciliation(s.database, id);
    expect(detail.items.some((item) => item.cleared)).toBe(false);
    expect(detail.endDate).toBe("2026-10-31");
    expect(detail.restorePoints.map((point) => [point.name, point.automatic])).toEqual([
      ["Before restoring Before checks", true],
      ["Before checks", false],
    ]);
  });
});

describe("IOLTA interest and notes", () => {
  it("adds interest and its sweep, ticked, outside every client ledger", async () => {
    const s = await setup();
    const id = await start(s);
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationInterest(
          s.database,
          id,
          {
            kind: "credited",
            postedOn: "2026-10-31",
            amountMinor: 1_000,
            description: "October interest",
            alsoSweep: true,
          },
          MARCO,
          options,
        )
      ).effect,
    );
    const detail = await readTrustBankReconciliation(s.database, id);
    expect(detail.interest.map((line) => [line.kind, line.amountMinor, line.cleared])).toEqual([
      ["credited", 1_000, true],
      ["swept", 1_000, true],
    ]);
    expect(detail.figures.depositedMinor).toBe(1_000);
    expect(detail.figures.withdrawnMinor).toBe(1_000);
  });

  it("keeps a line on the review list until it is resolved", async () => {
    const s = await setup();
    const id = await start(s);
    const detail = await readTrustBankReconciliation(s.database, id);
    const line = { kind: "entry" as const, entryId: detail.items[1]!.entryId };
    for (const input of [
      { line, kind: "needs_review" as const },
      { line, kind: "note" as const, body: "Not on the October statement." },
    ]) {
      await commit(
        s.database,
        (await composeTrustBankReconciliationNote(s.database, id, input, MARCO, options)).effect,
      );
    }
    let after = await readTrustBankReconciliation(s.database, id);
    expect(linesNeedingReview(after.notes).size).toBe(1);
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationNote(
          s.database,
          id,
          { line, kind: "resolved" },
          ELEANOR,
          options,
        )
      ).effect,
    );
    after = await readTrustBankReconciliation(s.database, id);
    expect(linesNeedingReview(after.notes).size).toBe(0);
    expect(after.notes.filter((note) => note.kind === "note")).toHaveLength(1);
  });
});

describe("finishing", () => {
  it("freezes the figures, refuses changes after, and starts the next one where it ended", async () => {
    const s = await setup();
    const id = await start(s);
    const detail = await readTrustBankReconciliation(s.database, id);
    await commit(
      s.database,
      (
        await composeTrustBankReconciliationEdits(
          s.database,
          id,
          [
            {
              kind: "tick",
              line: { kind: "entry", entryId: detail.items[0]!.entryId },
              cleared: true,
            },
          ],
          MARCO,
          options,
        )
      ).effect,
    );
    await commit(
      s.database,
      (await composeTrustBankReconciliationFinish(s.database, id, MARCO, options)).effect,
    );
    const finished = await readTrustBankReconciliation(s.database, id);
    expect(finished.reconciliation.finishedBy).toBe(MARCO);
    // Finished with a difference: the uncleared wire.
    expect(finished.figures.differenceMinor).toBe(-480_000);

    await expect(
      composeTrustBankReconciliationEdits(
        s.database,
        id,
        [{ kind: "end_balance", endBalanceMinor: 1 }],
        MARCO,
        options,
      ),
    ).rejects.toMatchObject({ code: "bank-reconciliation-finished" });
    await expectRefusal(() =>
      s.database
        .prepare(
          "INSERT INTO trust_bank_reconciliation_change (id, reconciliation_id, sequence, kind, end_balance_minor, cause, changed_by, changed_at) VALUES ('trustBankReconciliationChange_x', ?1, (SELECT MAX(sequence) + 1 FROM trust_bank_reconciliation_change WHERE reconciliation_id = ?1), 'end_balance', 1, 'edit', 'user_x', '2026-11-01T00:00:00.000Z')",
        )
        .bind(id)
        .run(),
    ).then(
      () => expect.unreachable("a finished reconciliation took a change"),
      (error: unknown) => expect(String(error)).toMatch(/finished/),
    );

    expect(await readNextBankReconciliationStart(s.database, s.accountId)).toEqual({
      startDate: "2026-11-01",
      startBalanceMinor: 2_020_000,
    });
    const next = await composeTrustBankReconciliationStart(
      s.database,
      { trustAccountId: s.accountId, endDate: "2026-11-15", startedBy: ELEANOR },
      options,
    );
    await commit(s.database, next.effect);
    const second = await readTrustBankReconciliation(s.database, next.reconciliationId);
    expect(second.reconciliation.startCarriedOver).toBe(true);
    // The deposit cleared last time; the wire is still outstanding.
    expect(second.items.map((item) => item.amountMinor)).toEqual([-480_000]);
    // And the first one still lists what it had when it was finished.
    expect((await readTrustBankReconciliation(s.database, id)).items).toHaveLength(2);

    const list = await readTrustBankReconciliations(s.database, s.accountId);
    expect(list.map((row) => row.reconciliation.finishedAt === null)).toEqual([true, false]);
  });

  it("needs an end balance", async () => {
    const s = await setup();
    const id = await start(s, null);
    await expect(
      composeTrustBankReconciliationFinish(s.database, id, MARCO, options),
    ).rejects.toMatchObject({ code: "bank-reconciliation-end-balance-required" });
  });
});
