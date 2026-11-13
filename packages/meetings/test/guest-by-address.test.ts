import type { MeetingId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { addGuestByAddress, splitTypedName } from "../src/guest-by-address.ts";
import { inviteGuest } from "../src/guest-service.ts";
import { createMeeting } from "../src/meeting-service.ts";
import { MeetingValidationError } from "../src/validation.ts";
import { MATTER_EVENT, commit, migratedDatabase, options, seedFirm } from "./support.ts";

// A GUEST TYPED BY NAME AND ADDRESS, over node:sqlite. What it turns on: an address the Directory
// already holds lands on that entity, an address it does not makes ONE person marked needs review, the
// guest ends up on the event so the ordinary invitation can be minted, and asking twice changes
// nothing a second time.

const KNOWN = "directoryPerson_guestByAddressKnown00" as const;
const created = "2026-08-01T00:00:00.000Z";

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  database.raw.exec(
    `INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES ` +
      `('${KNOWN}', 'Jane Hollis', '${created}', '${created}')`,
  );
  database.raw.exec(
    `INSERT INTO directory_email (id, entity_id, address, normalized_address, is_primary, created_at, updated_at) VALUES ` +
      `('directoryEmail_guestByAddressKnown00', '${KNOWN}', 'Jane@Example.test', 'jane@example.test', 1, '${created}', '${created}')`,
  );
  return database;
}

async function start(database: ReturnType<typeof fresh>): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId: MATTER_EVENT, lobby: "off" },
    options,
  );
  await commit(database.database, effect);
  return meetingId;
}

function onEvent(database: ReturnType<typeof fresh>, entityId: string): number {
  const row = database.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM matter_event_participant WHERE event_id = ? AND entity_id = ?`,
    )
    .get(MATTER_EVENT, entityId) as { count: number };
  return row.count;
}

describe("splitTypedName", () => {
  it("takes the last word as the family name", () => {
    expect(splitTypedName("  Mary Ann  Lopez ")).toEqual({ given: "Mary Ann", family: "Lopez" });
    expect(splitTypedName("Cher")).toEqual({ given: "Cher", family: "" });
  });
});

describe("a guest typed by name and address", () => {
  it("lands on the Directory entity that already holds the address, whatever its case", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const added = await addGuestByAddress(
      database.database,
      meetingId,
      { name: "J. Hollis", emailAddress: "JANE@example.test" },
      options,
    );
    await commit(database.database, added.effect);

    expect(added).toMatchObject({ entityId: KNOWN, created: false });
    expect(onEvent(database, KNOWN)).toBe(1);
    const people = database.raw.prepare(`SELECT COUNT(*) AS count FROM directory_person`).get() as {
      count: number;
    };
    expect(people.count).toBe(1);
  });

  it("makes one person marked needs review for an address nobody holds, and they can be invited", async () => {
    const database = fresh();
    const meetingId = await start(database);

    const added = await addGuestByAddress(
      database.database,
      meetingId,
      { name: "Ruth Okafor", emailAddress: "ruth@elsewhere.test" },
      options,
    );
    await commit(database.database, added.effect);

    expect(added.created).toBe(true);
    const person = database.raw
      .prepare(`SELECT name_given, name_family, needs_review FROM directory_person WHERE id = ?`)
      .get(added.entityId) as { name_given: string; name_family: string; needs_review: number };
    expect(person).toEqual({ name_given: "Ruth", name_family: "Okafor", needs_review: 1 });
    expect(onEvent(database, added.entityId)).toBe(1);

    const minted = await inviteGuest(
      database.database,
      meetingId,
      { entityId: added.entityId, eventEndsAt: () => "2026-09-21T17:30:00.000Z" },
      options,
    );
    expect(minted.emailAddress).toBe("ruth@elsewhere.test");
  });

  it("changes nothing the second time it is asked", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const input = { name: "Ruth Okafor", emailAddress: "ruth@elsewhere.test" };

    const first = await addGuestByAddress(database.database, meetingId, input, options);
    await commit(database.database, first.effect);
    const second = await addGuestByAddress(database.database, meetingId, input, options);
    await commit(database.database, second.effect);

    expect(second).toMatchObject({ entityId: first.entityId, created: false });
    expect(onEvent(database, first.entityId)).toBe(1);
  });

  it("refuses an address that is not one, without writing anything", async () => {
    const database = fresh();
    const meetingId = await start(database);

    await expect(
      addGuestByAddress(
        database.database,
        meetingId,
        { name: "Ruth Okafor", emailAddress: "not an address" },
        options,
      ),
    ).rejects.toBeInstanceOf(MeetingValidationError);
  });
});
