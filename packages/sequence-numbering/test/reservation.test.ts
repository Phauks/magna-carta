import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  allocateCounterValueStatement,
  readCounterValue,
  type SequenceNumberingTables,
} from "../src/counter-statements.ts";
import {
  DraftNumberNotHeldError,
  holdNumber,
  releaseNumber,
  type HoldRequest,
} from "../src/reservation.ts";
import { planSchemeDraw, schemeDrawOpeningStatements } from "../src/scheme-draw.ts";

// The draft number a create panel holds, proven on the shipped per-firm schema: the consultation
// run, whose built-in default ("C2026-0001", restarting each year) needs no scheme to be written
// first, counting in the matter tables it really counts in.
const TABLES: SequenceNumberingTables = {
  counterTable: "matter_number_counter",
  allocationTable: "matter_number_allocation",
  ownerColumn: "matter_id",
};
const SCOPE = "consultation/2026";
const NOW = "2026-11-14T01:00:00.000Z";
const LATER = "2026-11-14T01:30:00.000Z";
const RECEPTIONIST = "user_receptionist";
const PARALEGAL = "user_paralegal";

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

let minted = 0;
function request(overrides: Partial<HoldRequest> = {}): HoldRequest {
  return {
    purpose: "consultation",
    tables: TABLES,
    context: { openedDate: "2026-11-14" },
    holderUserId: RECEPTIONIST,
    now: NOW,
    newToken: () => `token-${(minted += 1)}`,
    ...overrides,
  };
}

async function seedMatter(database: BatchDatabase): Promise<MatterId> {
  const memberUserId = newIdentifier("user") as UserId;
  const matterId = newIdentifier("matter") as MatterId;
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(memberUserId, NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'consultation', ?2, ?3, ?3)",
    )
    .bind(matterId, memberUserId, NOW)
    .run();
  return matterId;
}

describe("holding a draft number", () => {
  it("holds the next number, and a second panel holds the one after it", async () => {
    const database = freshDatabase();
    const first = await holdNumber(database, request());
    const second = await holdNumber(database, request({ holderUserId: PARALEGAL }));
    expect(first.number).toBe("C2026-0001");
    expect(second.number).toBe("C2026-0002");
    expect(await readCounterValue(database, TABLES, SCOPE)).toBe(3);
  });

  it("gives two panels opening at the same moment two different numbers", async () => {
    const database = freshDatabase();
    const held = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        holdNumber(database, request({ holderUserId: `user_${index}` })),
      ),
    );
    expect(new Set(held.map((each) => each.number)).size).toBe(5);
  });

  it("keeps the same number when the panel asks again with its token", async () => {
    const database = freshDatabase();
    const first = await holdNumber(database, request());
    const again = await holdNumber(database, request({ token: first.token, now: LATER }));
    expect(again).toEqual({
      token: first.token,
      number: first.number,
      expiresAt: "2026-11-14T01:45:00.000Z",
    });
    expect(await readCounterValue(database, TABLES, SCOPE)).toBe(2);
  });

  it("gives a cancelled number to the next panel, so the run keeps no gap", async () => {
    const database = freshDatabase();
    const first = await holdNumber(database, request());
    await holdNumber(database, request({ holderUserId: PARALEGAL }));
    expect(await releaseNumber(database, first.token, RECEPTIONIST)).toBe(true);
    const next = await holdNumber(database, request({ holderUserId: PARALEGAL }));
    expect(next.number).toBe("C2026-0001");
  });

  it("lets nobody but the holder give a number back", async () => {
    const database = freshDatabase();
    const held = await holdNumber(database, request());
    expect(await releaseNumber(database, held.token, PARALEGAL)).toBe(false);
    const next = await holdNumber(database, request({ holderUserId: PARALEGAL }));
    expect(next.number).toBe("C2026-0002");
  });

  it("lets a hold left past its lapse be taken by the next panel", async () => {
    const database = freshDatabase();
    await holdNumber(database, request());
    const afterLapse = await holdNumber(
      database,
      request({ holderUserId: PARALEGAL, now: "2026-11-14T01:16:00.000Z" }),
    );
    expect(afterLapse.number).toBe("C2026-0001");
  });

  it("gives the old number back and holds a new one when the scope moves", async () => {
    const database = freshDatabase();
    const held = await holdNumber(database, request());
    const moved = await holdNumber(
      database,
      request({ token: held.token, context: { openedDate: "2027-01-02" } }),
    );
    expect(moved.number).toBe("C2027-0001");
    const back = await holdNumber(database, request({ holderUserId: PARALEGAL }));
    expect(back.number).toBe("C2026-0001");
  });

  it("refuses a run the register keeps previewed", async () => {
    const database = freshDatabase();
    await expect(
      holdNumber(database, request({ purpose: "invoice", tables: TABLES })),
    ).rejects.toBeInstanceOf(DraftNumberNotHeldError);
  });
});

describe("the save takes the held number", () => {
  it("draws exactly the held value, and removes the hold instead of moving the counter", async () => {
    const database = freshDatabase();
    const first = await holdNumber(database, request());
    await holdNumber(database, request({ holderUserId: PARALEGAL }));
    const plan = await planSchemeDraw(
      database,
      "consultation",
      TABLES,
      { openedDate: "2026-11-14" },
      { reservationToken: first.token, now: NOW },
    );
    expect(plan.number).toBe("C2026-0001");
    expect(plan.reservedFrom).toEqual({ purpose: "consultation" });
    const matterId = await seedMatter(database);
    for (const statement of schemeDrawOpeningStatements(database, TABLES, plan)) {
      await statement.run();
    }
    await allocateCounterValueStatement(
      database,
      TABLES,
      plan.scopeKey,
      plan.observedValue,
      matterId,
      NOW,
    ).run();
    expect(await readCounterValue(database, TABLES, SCOPE)).toBe(3);
    // The hold is gone: giving it back now changes nothing.
    expect(await releaseNumber(database, first.token, RECEPTIONIST)).toBe(false);
  });

  it("fills a given-back number before the counter moves, for a record saved without a panel", async () => {
    const database = freshDatabase();
    const first = await holdNumber(database, request());
    await holdNumber(database, request({ holderUserId: PARALEGAL }));
    await releaseNumber(database, first.token, RECEPTIONIST);
    const plan = await planSchemeDraw(database, "consultation", TABLES, {
      openedDate: "2026-11-14",
    });
    expect(plan.number).toBe("C2026-0001");
  });

  it("does not take a number somebody else still holds", async () => {
    const database = freshDatabase();
    await holdNumber(database, request());
    const plan = await planSchemeDraw(
      database,
      "consultation",
      TABLES,
      { openedDate: "2026-11-14" },
      { now: NOW },
    );
    expect(plan.number).toBe("C2026-0002");
    expect(plan.reservedFrom).toBeUndefined();
  });

  it("steps past a hold whose number a record already took", async () => {
    const database = freshDatabase();
    const held = await holdNumber(database, request());
    // A plain draw that read the counter in the same moment took the value.
    const matterId = await seedMatter(database);
    await allocateCounterValueStatement(database, TABLES, SCOPE, 1, matterId, NOW).run();
    const plan = await planSchemeDraw(
      database,
      "consultation",
      TABLES,
      { openedDate: "2026-11-14" },
      { reservationToken: held.token, now: NOW },
    );
    expect(plan.number).toBe("C2026-0002");
  });
});
