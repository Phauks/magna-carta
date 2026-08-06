import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { ClosePreconditionError } from "@magna-carta/matters/close-preconditions";
import { closeMatter } from "@magna-carta/matters/matter-service";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { loadMatterTrustLeaf } from "../src/account-tree.ts";
import {
  matterTrustClosePrecondition,
  readMatterTrustPositions,
  TRUST_BALANCE_BLOCKS_CLOSE,
  TRUST_HOLD_BLOCKS_CLOSE,
} from "../src/close-precondition.ts";
import { assertTrustFitness } from "../src/fitness.ts";
import { placeTrustHold } from "../src/holds.ts";
import { composeTrustDeposit, composeTrustDisbursement } from "../src/movements.ts";
import { clock, commit, options, seedMatter, seedMatterLeaf, trustFixture } from "./support.ts";

const usd = (minor: number) => money(minor, USD);
const RECORDER = "user_recorder" as UserId;

const CLOSE_PRECONDITIONS = [matterTrustClosePrecondition];

const fixtureWithJurisdiction = () => trustFixture({ jurisdiction: "US-NV" });

// The destination names only the matter — the client is derived from that matter's own client party.
const leafReference = (matterId: string, label: string) => ({
  matterId: matterId as never,
  clientNodeName: `Trust — ${label}`,
  matterLeafName: `Trust — ${label} — ${matterId}`,
});

function closeOptions(actorUserId: UserId) {
  return { clock, actorUserId, closePreconditions: CLOSE_PRECONDITIONS };
}

async function depositTo(
  fixture: Awaited<ReturnType<typeof trustFixture>>,
  matterId: string,
  label: string,
  amountMinor: number,
) {
  const deposit = await composeTrustDeposit(
    fixture.database,
    {
      trustAccountId: fixture.trustAccountId,
      to: leafReference(matterId, label),
      amount: usd(amountMinor),
      effectiveDate: "2026-08-05",
      description: "Retainer received",
      method: "check",
      reference: "1041",
      source: `${label} Holdings`,
      purpose: "Advance on fees and costs",
      recordedBy: RECORDER,
    },
    options,
  );
  await commit(fixture.database, deposit.effect);
  return deposit;
}

async function readMatterStatus(database: BatchDatabase, matterId: string): Promise<string> {
  const { results } = await database
    .prepare("SELECT status FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{ status: string }>();
  return results[0]?.status ?? "gone";
}

async function countCloseAudits(database: BatchDatabase, matterId: string): Promise<number> {
  const { results } = await database
    .prepare(
      "SELECT COUNT(*) AS closes FROM audit_log WHERE event = 'matter.closed' AND subject_id = ?1",
    )
    .bind(matterId)
    .all<{ closes: number }>();
  return results[0]?.closes ?? 0;
}

// Stands in for a concurrent writer landing between the close's precondition read and its commit.
// D1 has no interactive transaction, so that window is real; firing at the first batch makes it
// deterministic instead of dependent on how two promises happen to interleave.
function depositBeforeFirstCommit(
  database: BatchDatabase,
  before: () => Promise<unknown>,
): BatchDatabase {
  let fired = false;
  return {
    prepare: (sql: string) => database.prepare(sql),
    batch: async (statements) => {
      if (!fired) {
        fired = true;
        await before();
      }
      return database.batch(statements);
    },
  };
}

describe("the matter-close trust precondition", () => {
  it("closes a matter that holds no trust ledger at all", async () => {
    const fixture = await fixtureWithJurisdiction();
    const matterId = await seedMatter(fixture, "Nguyen", "entity_nguyen");

    expect(await readMatterTrustPositions(fixture.database, matterId)).toEqual([]);
    await closeMatter(fixture.database, matterId, closeOptions(fixture.memberUserId as UserId));

    expect(await readMatterStatus(fixture.database, matterId)).toBe("closed");
  });

  it("closes a matter whose client ledger exists but holds nothing", async () => {
    const fixture = await fixtureWithJurisdiction();
    const leaf = await seedMatterLeaf(fixture, "entity_park", "Park");

    await closeMatter(
      fixture.database,
      leaf.matterId,
      closeOptions(fixture.memberUserId as UserId),
    );

    expect(await readMatterStatus(fixture.database, leaf.matterId)).toBe("closed");
    // The guard writes a kind no CHECK admits, so a run that did NOT abort must have matched no
    // rows — the node is untouched.
    const { results } = await fixture.database
      .prepare("SELECT kind FROM trust_ledger_node WHERE id = ?1")
      .bind(leaf.nodeId)
      .all<{ kind: string }>();
    expect(results[0]?.kind).toBe("matter");
  });

  it("refuses a matter that still holds client money, naming the balance and the ways out", async () => {
    const fixture = await fixtureWithJurisdiction();
    const matterId = await seedMatter(fixture, "Webb", "entity_webb");
    await depositTo(fixture, matterId, "Webb", 125_000);

    const caught = await closeMatter(
      fixture.database,
      matterId,
      closeOptions(fixture.memberUserId as UserId),
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClosePreconditionError);
    const failures = (caught as ClosePreconditionError).failures;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.code).toBe(TRUST_BALANCE_BLOCKS_CLOSE);
    expect(failures[0]?.message).toContain("$1,250.00");
    expect(failures[0]?.message).toContain("IOLTA — Reno");
    expect(failures[0]?.message).toContain("disburse the remaining funds to the client");
    expect(failures[0]?.message).toContain("transfer earned fees to the operating account");
    // Refused, not half-done: the matter is untouched and nothing recorded a close.
    expect(await readMatterStatus(fixture.database, matterId)).toBe("open");
    expect(await countCloseAudits(fixture.database, matterId)).toBe(0);
  });

  it("names the held portion when part of the balance is under a disputed-funds hold", async () => {
    const fixture = await fixtureWithJurisdiction();
    const matterId = await seedMatter(fixture, "Webb", "entity_webb");
    await depositTo(fixture, matterId, "Webb", 125_000);
    const node = await loadMatterTrustLeaf(fixture.database, fixture.trustAccountId, matterId);
    const hold = await placeTrustHold(
      fixture.database,
      { nodeId: node.id, amount: usd(25_000), reason: "Fee dispute" },
      options,
    );
    await commit(fixture.database, hold.effect);

    const caught = await closeMatter(
      fixture.database,
      matterId,
      closeOptions(fixture.memberUserId as UserId),
    ).catch((error: unknown) => error);

    const failures = (caught as ClosePreconditionError).failures;
    expect(failures[0]?.code).toBe(TRUST_BALANCE_BLOCKS_CLOSE);
    expect(failures[0]?.message).toContain("$250.00 is under an active disputed-funds hold");
  });

  it("reports a hold on an empty ledger as its own refusal", async () => {
    const fixture = await fixtureWithJurisdiction();
    const leaf = await seedMatterLeaf(fixture, "entity_okafor", "Okafor");
    // A hold that outlived the money it was placed against — the state a correcting entry can leave
    // behind. Written directly, because the movement path will not disburse against a hold, which is
    // exactly the ordering that makes this state rare rather than impossible.
    await fixture.database
      .prepare(
        "INSERT INTO trust_hold (id, node_id, amount_minor, currency, reason, placed_at, placed_by, releases_hold_id) VALUES (?1, ?2, ?3, 'USD', 'Dispute', ?4, NULL, NULL)",
      )
      .bind(newIdentifier("trustHold"), leaf.nodeId, 5_000, clock.now())
      .run();

    const caught = await closeMatter(
      fixture.database,
      leaf.matterId,
      closeOptions(fixture.memberUserId as UserId),
    ).catch((error: unknown) => error);

    const failures = (caught as ClosePreconditionError).failures;
    expect(failures[0]?.code).toBe(TRUST_HOLD_BLOCKS_CLOSE);
    expect(failures[0]?.message).toContain("$50.00");
    expect(failures[0]?.message).toContain("Release the hold");
    expect(await readMatterStatus(fixture.database, leaf.matterId)).toBe("open");
  });

  it("aborts the close batch when a deposit lands between the check and the commit", async () => {
    const fixture = await fixtureWithJurisdiction();
    const matterId = await seedMatter(fixture, "Delacroix", "entity_delacroix");
    // The check reads an empty ledger; the deposit commits before the close batch does.
    const racing = depositBeforeFirstCommit(fixture.database, () =>
      depositTo(fixture, matterId, "Delacroix", 90_000),
    );

    const caught = await closeMatter(
      racing,
      matterId,
      closeOptions(fixture.memberUserId as UserId),
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClosePreconditionError);
    expect((caught as ClosePreconditionError).failures[0]?.code).toBe(TRUST_BALANCE_BLOCKS_CLOSE);
    // The guard fires as a constraint violation, so the WHOLE batch rolled back: the matter is open,
    // no audit row claims it closed, and the node the guard aimed at is intact.
    expect(await readMatterStatus(fixture.database, matterId)).toBe("open");
    expect(await countCloseAudits(fixture.database, matterId)).toBe(0);
    await assertTrustFitness(fixture.database);
  });

  it("closes once the balance is disbursed back to zero", async () => {
    const fixture = await fixtureWithJurisdiction();
    const matterId = await seedMatter(fixture, "Solberg", "entity_solberg");
    await depositTo(fixture, matterId, "Solberg", 60_000);
    const node = await loadMatterTrustLeaf(fixture.database, fixture.trustAccountId, matterId);
    const disbursement = await composeTrustDisbursement(
      fixture.database,
      {
        fromNodeId: node.id,
        amount: usd(60_000),
        effectiveDate: "2026-08-05",
        description: "Balance returned to the client",
        method: "check",
        payee: "Solberg",
        purpose: "Refund of unused retainer",
        recordedBy: RECORDER,
        authorizedBy: RECORDER,
      },
      options,
    );
    await commit(fixture.database, disbursement.effect);

    await closeMatter(fixture.database, matterId, closeOptions(fixture.memberUserId as UserId));

    expect(await readMatterStatus(fixture.database, matterId)).toBe("closed");
    await assertTrustFitness(fixture.database);
  });
});
