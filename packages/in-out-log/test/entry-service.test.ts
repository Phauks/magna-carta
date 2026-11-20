import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import type { CustodyPacketId, InOutEntryId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  deleteWaitingEntry,
  recordDropOff,
  recordMovedToCustodian,
  recordPickUp,
  type DropOffInput,
} from "../src/entry-service.ts";
import {
  readEntry,
  readRecipients,
  selectEntriesStatement,
  type InOutEntryRow,
} from "../src/entry-statements.ts";
import { InOutValidationError } from "../src/validation.ts";
import {
  ACTOR,
  HOLDING_MATTER,
  LAWYER,
  MATTER,
  commit,
  migratedDatabase,
  seedFirm,
  serviceOptions,
  tickingClock,
  visibility,
} from "./support.ts";

const DROP_OFF: DropOffInput = {
  description: "Signed lease and two bank statements",
  from: { kind: "entity", entityId: "directoryPerson_priyaShah000000000", name: "Priya Shah" },
  to: [
    { kind: "member", userId: LAWYER, name: "Trevor Goldsmith" },
    { kind: "external", name: "Rapid Legal courier" },
  ],
  matterId: MATTER,
  keptAt: "Front desk tray",
};

async function setUp() {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const options = serviceOptions(tickingClock());
  async function dropOff(input: DropOffInput = DROP_OFF) {
    const created = await recordDropOff(database, input, options);
    await commit(database, created.effect);
    return created;
  }
  return { database, raw, options, dropOff };
}

async function waitingPage(database: Parameters<typeof readEntry>[0]): Promise<InOutEntryRow[]> {
  const { results } = await selectEntriesStatement(database, visibility, {
    status: "waiting",
    limit: 50,
  }).all<InOutEntryRow>();
  return results;
}

describe("Drop Off", () => {
  it("numbers each entry from the firm's In/Out Log run, IO-0001 onward", async () => {
    const { dropOff } = await setUp();
    const first = await dropOff();
    const second = await dropOff();
    expect(first.number).toBe("IO-0001");
    expect(second.number).toBe("IO-0002");
  });

  it("keeps who it is to, in the order they were listed, and names the matter", async () => {
    const { database, dropOff } = await setUp();
    const { entryId } = await dropOff();
    const entry = await readEntry(database, entryId, visibility);
    expect(entry?.status).toBe("waiting");
    expect(entry?.matter_title).toBe("Alvarez Estate");
    expect(entry?.from_name).toBe("Priya Shah");
    const recipients = await readRecipients(database, [entryId]);
    expect(recipients.map((recipient) => recipient.name)).toEqual([
      "Trevor Goldsmith",
      "Rapid Legal courier",
    ]);
  });

  it("refuses an entry nobody may collect", async () => {
    const { database, options } = await setUp();
    await expect(recordDropOff(database, { ...DROP_OFF, to: [] }, options)).rejects.toMatchObject({
      code: "in-out-no-recipients",
    });
  });

  it("refuses a member who is not in the firm", async () => {
    const { database, options } = await setUp();
    await expect(
      recordDropOff(
        database,
        { ...DROP_OFF, to: [{ kind: "member", userId: "user_nobody000000000", name: "Nobody" }] },
        options,
      ),
    ).rejects.toBeInstanceOf(InOutValidationError);
  });

  it("refuses the platform-owned custody holding matter as if it did not exist", async () => {
    const { database, options } = await setUp();
    await expect(
      recordDropOff(database, { ...DROP_OFF, matterId: HOLDING_MATTER }, options),
    ).rejects.toMatchObject({ code: "in-out-unknown-matter" });
  });

  it("takes an entry with no matter at all", async () => {
    const { database, dropOff } = await setUp();
    const { entryId } = await dropOff({ ...DROP_OFF, matterId: null });
    expect((await readEntry(database, entryId, visibility))?.matter_id).toBeNull();
  });
});

describe("Pick Up", () => {
  it("records one of the listed people as the collector and leaves Waiting for Pickup", async () => {
    const { database, options, dropOff } = await setUp();
    const { entryId } = await dropOff();
    const [, courier] = await readRecipients(database, [entryId]);
    const { effect } = await recordPickUp(
      database,
      entryId,
      { recipientId: courier?.id, identityChecked: true },
      options,
    );
    await commit(database, effect);
    const entry = await readEntry(database, entryId, visibility);
    expect(entry?.status).toBe("picked_up");
    expect(entry?.picked_up_by_name).toBe("Rapid Legal courier");
    expect(entry?.identity_checked).toBe(1);
    expect(entry?.handed_over_by_user_id).toBe(ACTOR);
    expect(await waitingPage(database)).toHaveLength(0);
  });

  it("takes somebody who is not listed, by name", async () => {
    const { database, options, dropOff } = await setUp();
    const { entryId } = await dropOff();
    const { effect } = await recordPickUp(
      database,
      entryId,
      { collector: { kind: "external", name: "Luis Alvarez" }, identityChecked: false },
      options,
    );
    await commit(database, effect);
    expect((await readEntry(database, entryId, visibility))?.picked_up_by_name).toBe(
      "Luis Alvarez",
    );
  });

  it("refuses a second pick up of the same entry", async () => {
    const { database, options, dropOff } = await setUp();
    const { entryId } = await dropOff();
    const [first] = await readRecipients(database, [entryId]);
    const pickUp = { recipientId: first?.id, identityChecked: true };
    const firstEffect = (await recordPickUp(database, entryId, pickUp, options)).effect;
    const racingEffect = (await recordPickUp(database, entryId, pickUp, options)).effect;
    await commit(database, firstEffect);
    // The second was built from a read taken before the first committed; its guard refuses it.
    await expect(commit(database, racingEffect)).rejects.toBeInstanceOf(GuardedWriteRefusedError);
    await expect(recordPickUp(database, entryId, pickUp, options)).rejects.toMatchObject({
      code: "in-out-not-waiting",
    });
  });
});

describe("Move to Custodian and Delete", () => {
  it("refuses a packet that is not in the register", async () => {
    const { database, options, dropOff } = await setUp();
    const { entryId } = await dropOff();
    await expect(
      recordMovedToCustodian(
        database,
        entryId,
        "custodyPacket_missing0000000000000" as CustodyPacketId,
        options,
      ),
    ).rejects.toMatchObject({ code: "in-out-unknown-packet" });
  });

  it("deletes a waiting entry with the people it was to", async () => {
    const { database, options, dropOff } = await setUp();
    const { entryId } = await dropOff();
    await commit(database, (await deleteWaitingEntry(database, entryId, options)).effect);
    expect(await readEntry(database, entryId, visibility)).toBeUndefined();
    expect(await readRecipients(database, [entryId])).toHaveLength(0);
  });

  it("refuses to delete an entry that has been picked up", async () => {
    const { database, options, dropOff } = await setUp();
    const { entryId } = await dropOff();
    const [first] = await readRecipients(database, [entryId]);
    await commit(
      database,
      (
        await recordPickUp(
          database,
          entryId,
          { recipientId: first?.id, identityChecked: false },
          options,
        )
      ).effect,
    );
    await expect(deleteWaitingEntry(database, entryId, options)).rejects.toMatchObject({
      code: "in-out-not-waiting",
    });
  });

  it("refuses an entry id the firm does not hold", async () => {
    const { database, options } = await setUp();
    await expect(
      deleteWaitingEntry(database, "inOutEntry_missing00000000000000" as InOutEntryId, options),
    ).rejects.toMatchObject({ code: "in-out-unknown-entry" });
  });
});

describe("the log read", () => {
  it("lists waiting entries oldest first and finds one by who it is to", async () => {
    const { database, dropOff } = await setUp();
    const first = await dropOff();
    await dropOff({ ...DROP_OFF, description: "Copies of closing documents" });
    const waiting = await waitingPage(database);
    expect(waiting.map((row) => row.number)).toEqual(["IO-0001", "IO-0002"]);
    const { results } = await selectEntriesStatement(database, visibility, {
      search: "courier",
      limit: 50,
    }).all<InOutEntryRow>();
    expect(results).toHaveLength(2);
    const { results: byNumber } = await selectEntriesStatement(database, visibility, {
      search: first.number,
      limit: 50,
    }).all<InOutEntryRow>();
    expect(byNumber.map((row) => row.id)).toEqual([first.entryId]);
  });
});
