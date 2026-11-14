import type { TrustMovementId, UserId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import {
  amountInFigures,
  amountInWords,
  checkFieldListProblem,
  checkFieldProblem,
  STANDARD_CHECK_FIELDS,
} from "../src/check-layout.ts";
import {
  composeTrustCheckNumberVoid,
  composeTrustCheckPrint,
  composeTrustCheckResults,
  composeTrustCheckStockSave,
  composeTrustCheckVoid,
  readNextTrustCheckNumber,
  readTrustCheckRegister,
  readTrustChecksToPrint,
  readTrustPaymentsWithTwoLiveChecks,
} from "../src/checks.ts";
import { composeTrustDeposit, composeTrustDisbursement } from "../src/movements.ts";
import { selectOutstandingTrustBankItemsStatement } from "../src/statements.ts";
import { commit, expectRefusal, options, seedMatter, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);
const RECORDER = "user_recorder" as UserId;
const AUTHORIZER = "user_authorizer" as UserId;

async function fundedAccount() {
  const fixture = await trustFixture({ jurisdiction: "US-NV" });
  const matterId = await seedMatter(fixture, "Harrington", "entity_harrington");
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: {
        matterId: matterId as never,
        clientNodeName: "Trust — Harrington",
        matterLeafName: `Trust — Harrington — ${matterId}`,
      },
      amount: usd(1_000_000),
      effectiveDate: "2026-08-05",
      description: "Closing funds received",
      method: "wire",
      source: "Harrington",
      purpose: "Closing funds",
      recordedBy: RECORDER,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  const node = await loadMatterTrustLeaf(fixture.database, fixture.trustAccountId, matterId as never);
  return { fixture, node };
}

async function pay(
  setup: Awaited<ReturnType<typeof fundedAccount>>,
  amountMinor: number,
  payee: string,
  method: "check" | "wire" = "check",
  reference: string | null = null,
): Promise<TrustMovementId> {
  const paid = await composeTrustDisbursement(
    setup.fixture.database,
    {
      fromNodeId: setup.node.id,
      amount: usd(amountMinor),
      effectiveDate: "2026-08-05",
      description: `Paid ${payee}`,
      method,
      reference,
      payee,
      purpose: "Closing costs",
      recordedBy: RECORDER,
      authorizedBy: AUTHORIZER,
    },
    options,
  );
  await commit(setup.fixture.database, paid.effect);
  return paid.movementId;
}

async function saveStock(setup: Awaited<ReturnType<typeof fundedAccount>>, startingCheckNumber = 10_422) {
  const saved = await composeTrustCheckStockSave(
    setup.fixture.database,
    {
      trustAccountId: setup.fixture.trustAccountId,
      name: "IOLTA checks, voucher bottom",
      pageLayout: "check_top",
      fields: STANDARD_CHECK_FIELDS,
      shiftXMils: 0,
      shiftYMils: 0,
      startingCheckNumber,
      scan: null,
      savedBy: RECORDER,
    },
    options,
  );
  await commit(setup.fixture.database, saved.effect);
  return saved;
}

describe("amount in words", () => {
  it("writes dollars in words and cents over a hundred", () => {
    expect(amountInWords(300_000)).toBe("Three thousand and 00/100");
    expect(amountInWords(8_400)).toBe("Eighty-four and 00/100");
    expect(amountInWords(125_099)).toBe("One thousand two hundred fifty and 99/100");
    expect(amountInWords(1)).toBe("Zero and 01/100");
    expect(amountInWords(100_000_001_00)).toBe("One hundred million one and 00/100");
    expect(amountInWords(1_211_900)).toBe("Twelve thousand one hundred nineteen and 00/100");
    expect(() => amountInWords(0)).toThrow(RangeError);
  });

  it("writes figures with leading asterisks", () => {
    expect(amountInFigures(300_000)).toBe("**3,000.00");
    expect(amountInFigures(8_405)).toBe("**84.05");
  });
});

describe("check layout", () => {
  it("accepts the standard positions", () => {
    expect(checkFieldListProblem(STANDARD_CHECK_FIELDS)).toBeNull();
  });

  it("refuses a field in the MICR band", () => {
    const memo = { kind: "memo", xMils: 700, yMils: 2_900, widthMils: 3_000, sizePoints: 10, align: "start" } as const;
    expect(checkFieldProblem(memo)).toMatch(/MICR band/);
  });

  it("refuses a layout without the amount", () => {
    expect(
      checkFieldListProblem(STANDARD_CHECK_FIELDS.filter((field) => field.kind !== "amount")),
    ).toMatch(/amount/);
  });
});

describe("check printing", () => {
  it("queues check payments with no number, and only those", async () => {
    const setup = await fundedAccount();
    const queued = await pay(setup, 300_000, "Desert Title Company");
    await pay(setup, 8_400, "Clark County Recorder", "check", "2207");
    await pay(setup, 5_000, "Wired Away", "wire");
    const queue = await readTrustChecksToPrint(setup.fixture.database, setup.fixture.trustAccountId);
    expect(queue.map((item) => item.movementId)).toEqual([queued]);
    expect(queue[0]).toMatchObject({ payee: "Desert Title Company", amountMinor: 300_000 });
  });

  it("refuses to print without a stock", async () => {
    const setup = await fundedAccount();
    const movementId = await pay(setup, 300_000, "Desert Title Company");
    await expect(
      composeTrustCheckPrint(
        setup.fixture.database,
        { trustAccountId: setup.fixture.trustAccountId, movementIds: [movementId], numberedBy: RECORDER },
        options,
      ),
    ).rejects.toMatchObject({ code: "check-stock-missing" });
  });

  it("numbers from the starting number, spoils, reprints on a new number, and keeps both", async () => {
    const setup = await fundedAccount();
    const stock = await saveStock(setup);
    expect(stock.version).toBe(1);
    const first = await pay(setup, 300_000, "Desert Title Company");
    const second = await pay(setup, 125_000, "Jordan Smith");
    const { database, trustAccountId } = setup.fixture;

    const printed = await composeTrustCheckPrint(
      database,
      { trustAccountId, movementIds: [first, second], numberedBy: RECORDER },
      options,
    );
    await commit(database, printed.effect);
    expect(printed.checks.map((check) => check.checkNumber)).toEqual([10_422, 10_423]);
    expect(await readTrustChecksToPrint(database, trustAccountId)).toEqual([]);

    // The bank's statement can now match on the printed number.
    const { results } = await selectOutstandingTrustBankItemsStatement(
      database,
      setup.fixture.bankLedgerAccountId,
      "2026-12-31",
    ).all<{ reference: string | null; movement_id: string | null }>();
    expect(results.find((row) => row.movement_id === first)?.reference).toBe("10422");

    const [firstCheck, secondCheck] = printed.checks;
    const answered = await composeTrustCheckResults(
      database,
      {
        trustAccountId,
        results: [
          { checkId: firstCheck!.checkId, outcome: "printed" },
          { checkId: secondCheck!.checkId, outcome: "spoiled" },
        ],
        recordedBy: RECORDER,
      },
      options,
    );
    await commit(database, answered.effect);

    const queue = await readTrustChecksToPrint(database, trustAccountId);
    expect(queue.map((item) => item.movementId)).toEqual([second]);
    expect(queue[0]?.earlierCheckNumbers).toEqual([10_423]);

    const reprinted = await composeTrustCheckPrint(
      database,
      { trustAccountId, movementIds: [second], numberedBy: RECORDER },
      options,
    );
    await commit(database, reprinted.effect);
    expect(reprinted.checks[0]?.checkNumber).toBe(10_424);

    const register = await readTrustCheckRegister(database, trustAccountId);
    expect(register.map((row) => [row.checkNumber, row.status])).toEqual([
      [10_424, "numbered"],
      [10_423, "spoiled"],
      [10_422, "printed"],
    ]);
    expect(register[1]?.settledReason).toBe("Spoiled in printing");
    expect(await readTrustPaymentsWithTwoLiveChecks(database)).toEqual([]);
  });

  it("voids a printed check with a reason and queues its payment again, never twice", async () => {
    const setup = await fundedAccount();
    await saveStock(setup);
    const movementId = await pay(setup, 300_000, "Desert Title Company");
    const { database, trustAccountId } = setup.fixture;
    const printed = await composeTrustCheckPrint(
      database,
      { trustAccountId, movementIds: [movementId], numberedBy: RECORDER },
      options,
    );
    await commit(database, printed.effect);
    const checkId = printed.checks[0]!.checkId;
    await commit(
      database,
      (await composeTrustCheckResults(database, { trustAccountId, results: [{ checkId, outcome: "printed" }], recordedBy: RECORDER }, options)).effect,
    );
    await expect(
      composeTrustCheckVoid(database, { trustAccountId, checkId, reason: " ", recordedBy: RECORDER }, options),
    ).rejects.toMatchObject({ code: "check-void-reason-missing" });
    const voided = await composeTrustCheckVoid(
      database,
      { trustAccountId, checkId, reason: "Lost in the mail", recordedBy: RECORDER },
      options,
    );
    await commit(database, voided.effect);
    expect((await readTrustChecksToPrint(database, trustAccountId)).length).toBe(1);
    await expect(
      composeTrustCheckVoid(database, { trustAccountId, checkId, reason: "Again", recordedBy: RECORDER }, options),
    ).rejects.toMatchObject({ code: "check-already-answered" });
    // The trigger holds the same rule for a caller that skipped the composer.
    await expect(
      expectRefusal(() =>
        commit(database, voided.effect),
      ),
    ).rejects.toThrow();
  });

  it("voids an unused number and moves the next number past it", async () => {
    const setup = await fundedAccount();
    await saveStock(setup, 500);
    const { database, trustAccountId } = setup.fixture;
    const voided = await composeTrustCheckNumberVoid(
      database,
      { trustAccountId, reason: "Torn in the printer", recordedBy: RECORDER },
      options,
    );
    await commit(database, voided.effect);
    expect(voided.checkNumber).toBe(500);
    const stock = await composeTrustCheckStockSave(
      database,
      {
        trustAccountId,
        name: "New box",
        pageLayout: "check_top",
        fields: STANDARD_CHECK_FIELDS,
        shiftXMils: 20,
        shiftYMils: -40,
        startingCheckNumber: 100,
        scan: null,
        savedBy: RECORDER,
      },
      options,
    );
    await commit(database, stock.effect);
    // A starting number below a used one never reuses it.
    expect(await readNextTrustCheckNumber(database, trustAccountId, { startingCheckNumber: 100 } as never)).toBe(501);
  });

  it("refuses a stock with a field in the MICR band", async () => {
    const setup = await fundedAccount();
    await expect(
      composeTrustCheckStockSave(
        setup.fixture.database,
        {
          trustAccountId: setup.fixture.trustAccountId,
          name: "Bad",
          pageLayout: "check_top",
          fields: STANDARD_CHECK_FIELDS.map((field) =>
            field.kind === "memo" ? { ...field, yMils: 3_000 } : field,
          ),
          shiftXMils: 0,
          shiftYMils: 0,
          startingCheckNumber: 1,
          scan: null,
          savedBy: RECORDER,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "check-stock-invalid" });
  });

  it("refuses a second batch that took the same numbers", async () => {
    const setup = await fundedAccount();
    await saveStock(setup);
    const first = await pay(setup, 300_000, "Desert Title Company");
    const second = await pay(setup, 125_000, "Jordan Smith");
    const { database, trustAccountId } = setup.fixture;
    const one = await composeTrustCheckPrint(database, { trustAccountId, movementIds: [first], numberedBy: RECORDER }, options);
    const two = await composeTrustCheckPrint(database, { trustAccountId, movementIds: [second], numberedBy: RECORDER }, options);
    await commit(database, one.effect);
    await expect(expectRefusal(() => commit(database, two.effect))).rejects.toThrow(/UNIQUE|unique/);
  });
});
