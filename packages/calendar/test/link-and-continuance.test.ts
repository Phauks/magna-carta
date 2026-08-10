import { describe, expect, it } from "vitest";
import type { MatterEventId } from "@magna-carta/identifiers/types";
import { continueMatterEvent, readContinuanceChain } from "../src/continuance-service.ts";
import { createMatterDeadline } from "../src/deadline-service.ts";
import { createMatterEvent } from "../src/event-service.ts";
import { readMatterEvent, readMatterEventParticipants } from "../src/event-statements.ts";
import { createFirmEvent } from "../src/firm-event-service.ts";
import { createRelatedLink, deleteRelatedLink } from "../src/link-service.ts";
import {
  readContinuancePredecessorLink,
  readContinuanceSuccessorLink,
} from "../src/link-statements.ts";
import { CalendarValidationError } from "../src/validation.ts";
import {
  ACTOR,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedMatters,
  visibility,
} from "./support.ts";

// Event links and the honest continuance: a correction stays an edit, a continuance is a new
// setting pointing at the vacated one, and the record shows what was continued from what without
// falsifying anything.

function seeded() {
  const context = migratedDatabase();
  seedMatters(context.raw);
  return context;
}

async function seedHearing(
  database: ReturnType<typeof seeded>["database"],
  overrides: Partial<Parameters<typeof createMatterEvent>[1]> = {},
): Promise<MatterEventId> {
  const created = createMatterEvent(
    database,
    {
      matterId: MATTER,
      title: "Hearing on the motion to compel",
      startsOn: "2026-09-14",
      startsAtTime: "09:00",
      timeZone: "America/Los_Angeles",
      participants: [
        { participantKind: "external", participantName: "Hon. A. Judge", role: "judge" },
        { participantKind: "member", memberUserId: ACTOR, role: "appearing counsel" },
      ],
      ...overrides,
    },
    options,
  );
  await commit(database, created.effect);
  return created.eventId;
}

describe("related links", () => {
  it("links two events, refuses the duplicate pair in either direction, and deletes outright", async () => {
    const { database } = seeded();
    const prep = await seedHearing(database, { title: "Prep session", startsOn: "2026-09-10" });
    const firmEvent = await createFirmEvent(
      database,
      { title: "War-room afternoon", startsOn: "2026-09-11", timeZone: "America/Los_Angeles" },
      options,
    );
    await commit(database, firmEvent.effect);

    const link = await createRelatedLink(
      database,
      {
        from: { matterEventId: prep },
        to: { firmEventId: firmEvent.firmEventId },
        note: "Prep for the Malloy deposition",
      },
      options,
    );
    await commit(database, link.effect);

    // The same pair, both orientations: refused by the service.
    await expect(
      createRelatedLink(
        database,
        { from: { matterEventId: prep }, to: { firmEventId: firmEvent.firmEventId } },
        options,
      ),
    ).rejects.toThrow(/already related/);
    await expect(
      createRelatedLink(
        database,
        { from: { firmEventId: firmEvent.firmEventId }, to: { matterEventId: prep } },
        options,
      ),
    ).rejects.toThrow(/already related/);

    const deleted = await deleteRelatedLink(database, link.calendarEventLinkId, options);
    await commit(database, deleted.effect);
    // Gone means the pair can be linked again: a true delete, not a tombstone.
    const relinked = await createRelatedLink(
      database,
      { from: { matterEventId: prep }, to: { firmEventId: firmEvent.firmEventId } },
      options,
    );
    await commit(database, relinked.effect);
  });

  it("refuses a self-link and an end that does not exist", async () => {
    const { database } = seeded();
    const hearing = await seedHearing(database);
    await expect(
      createRelatedLink(
        database,
        { from: { matterEventId: hearing }, to: { matterEventId: hearing } },
        options,
      ),
    ).rejects.toThrow(/does not relate to itself/);
    await expect(
      createRelatedLink(
        database,
        {
          from: { matterEventId: hearing },
          to: { matterEventId: "matterEvent_missing00000000000000" as MatterEventId },
        },
        options,
      ),
    ).rejects.toThrow(/no such event/);
  });
});

describe("the continuance operation", () => {
  it("produces the new setting, the vacated old one, and one chain link — with history untouched", async () => {
    const { database, raw } = seeded();
    const oldId = await seedHearing(database);
    const before = raw.prepare("SELECT * FROM matter_event WHERE id = ?").get(oldId) as Record<
      string,
      unknown
    >;

    const continued = await continueMatterEvent(
      database,
      oldId,
      {
        startsOn: "2026-11-02",
        startsAtTime: "10:30",
        statusReason: "Continued on defendant's motion",
      },
      options,
    );
    await commit(database, continued.effect);

    // The old row: byte-identical in every historical column; only status, status_reason, and
    // updated_at moved. This is the honest-history property the whole design turns on.
    const after = raw.prepare("SELECT * FROM matter_event WHERE id = ?").get(oldId) as Record<
      string,
      unknown
    >;
    expect(after["status"]).toBe("cancelled");
    expect(after["status_reason"]).toBe("Continued on defendant's motion");
    for (const column of Object.keys(before)) {
      if (column === "status" || column === "status_reason" || column === "updated_at") continue;
      expect(after[column], `column ${column} moved`).toEqual(before[column]);
    }

    // The new row: the setting as it now stands, same title and type, participants copied as a
    // fresh replace-set.
    const newEvent = await readMatterEvent(database, continued.newEventId, visibility);
    expect(newEvent?.status).toBe("scheduled");
    expect(newEvent?.starts_on).toBe("2026-11-02");
    expect(newEvent?.starts_at_time).toBe("10:30");
    expect(newEvent?.title).toBe(before["title"]);
    const participants = await readMatterEventParticipants(database, continued.newEventId);
    expect(participants).toHaveLength(2);

    // One link, new setting to old.
    const predecessor = await readContinuancePredecessorLink(database, continued.newEventId);
    expect(predecessor?.to_matter_event_id).toBe(oldId);
    const successor = await readContinuanceSuccessorLink(database, oldId);
    expect(successor?.from_matter_event_id).toBe(continued.newEventId);

    // Both audit rows, identifiers only.
    const audits = raw
      .prepare(
        "SELECT event, metadata FROM audit_log WHERE event IN ('calendar.event.continued', 'calendar.event.created') ORDER BY event",
      )
      .all() as { event: string; metadata: string | null }[];
    expect(audits.map((entry) => entry.event)).toContain("calendar.event.continued");
    for (const entry of audits) {
      expect(entry.metadata ?? "").not.toContain("motion to compel");
    }
  });

  it("reports trigger-linked open deadlines as a pure lookup — nothing moves", async () => {
    const { database, raw } = seeded();
    const oldId = await seedHearing(database);
    const deadline = await createMatterDeadline(
      database,
      {
        matterId: MATTER,
        title: "Opposition due",
        dueOn: "2026-09-07",
        timeZone: "America/Los_Angeles",
        triggerEventId: oldId,
      },
      options,
    );
    await commit(database, deadline.effect);
    const satisfiedElsewhere = await createMatterDeadline(
      database,
      {
        matterId: MATTER,
        title: "Reply due",
        dueOn: "2026-09-10",
        timeZone: "America/Los_Angeles",
      },
      options,
    );
    await commit(database, satisfiedElsewhere.effect);

    const continued = await continueMatterEvent(
      database,
      oldId,
      { startsOn: "2026-11-02" },
      options,
    );
    await commit(database, continued.effect);

    // The lookup names exactly the open deadlines whose trigger is the continued event.
    expect(continued.triggerLinkedOpenDeadlines.map((row) => row.id)).toEqual([
      deadline.deadlineId,
    ]);
    // And NOTHING moved: the deadline's date is byte-identical, because what a continuance does to
    // a briefing schedule is a legal judgement, not arithmetic.
    const row = raw
      .prepare("SELECT due_on, state FROM matter_deadline WHERE id = ?")
      .get(deadline.deadlineId) as { due_on: string; state: string };
    expect(row).toEqual({ due_on: "2026-09-07", state: "open" });
  });

  it("refuses a cancelled setting, refuses a second continuance, and the schema backstops a race", async () => {
    const { database, raw } = seeded();
    const oldId = await seedHearing(database);
    const continued = await continueMatterEvent(
      database,
      oldId,
      { startsOn: "2026-11-02" },
      options,
    );
    await commit(database, continued.effect);

    // The service refuses first, with a name.
    await expect(
      continueMatterEvent(database, oldId, { startsOn: "2026-12-01" }, options),
    ).rejects.toThrow(/already/);

    // The backstop: even bypassing the service, the partial unique refuses the fork under raw SQL —
    // which is what holds under two racing writes.
    expect(() =>
      raw.exec(
        `INSERT INTO calendar_event_link (id, from_matter_event_id, to_matter_event_id, kind, created_at)
           VALUES ('calendarEventLink_race00000000000', '${continued.newEventId}', '${oldId}', 'continuance_of', '2026-08-07T09:00:00.000Z')`,
      ),
    ).toThrow();
  });

  it("keeps the no-arithmetic scan green: the new setting's date is the caller's, verbatim", async () => {
    const { database } = seeded();
    const oldId = await seedHearing(database);
    const continued = await continueMatterEvent(
      database,
      oldId,
      { startsOn: "2027-01-19", startsAtTime: "08:15", timeZone: "America/Denver" },
      options,
    );
    await commit(database, continued.effect);
    const newEvent = await readMatterEvent(database, continued.newEventId, visibility);
    expect(newEvent?.starts_on).toBe("2027-01-19");
    expect(newEvent?.time_zone).toBe("America/Denver");
  });
});

describe("the chain read", () => {
  async function chainOf(database: ReturnType<typeof seeded>["database"], settings: number) {
    const ids: MatterEventId[] = [await seedHearing(database)];
    for (let index = 1; index < settings; index += 1) {
      const continued = await continueMatterEvent(
        database,
        ids[index - 1] as MatterEventId,
        { startsOn: `2027-0${index}-10`, statusReason: `Continued (${index})` },
        options,
      );
      await commit(database, continued.effect);
      ids.push(continued.newEventId);
    }
    return ids;
  }

  it("walks the whole chain in order from any node, in both directions", async () => {
    const { database } = seeded();
    const ids = await chainOf(database, 5);
    // From the middle: the full five-node path, oldest first.
    const chain = await readContinuanceChain(database, ids[2] as MatterEventId, options);
    expect(chain.map((node) => node.eventId)).toEqual(ids);
    // Every vacated setting shows cancelled with its reason; the live end is scheduled.
    expect(chain.slice(0, -1).every((node) => node.status === "cancelled")).toBe(true);
    expect(chain.at(-1)?.status).toBe("scheduled");
    expect(chain[0]?.statusReason).toBe("Continued (1)");
  });

  it("caps the walk at the depth bound with a named refusal", async () => {
    const { database, raw } = seeded();
    // Fabricate an over-deep chain directly — the operation could never mint one this long in a
    // test's lifetime, and the cap exists for corrupt data, not for litigation.
    const ids: string[] = [];
    for (let index = 0; index < 102; index += 1) {
      const id = `matterEvent_deep${String(index).padStart(17, "0")}`;
      ids.push(id);
      raw.exec(
        `INSERT INTO matter_event (id, matter_id, title, status, starts_on, time_zone, recorded_at, created_at, updated_at)
           VALUES ('${id}', '${MATTER}', 'Setting ${index}', '${index === 101 ? "scheduled" : "cancelled"}', '2026-09-14', 'America/Los_Angeles', '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z')`,
      );
    }
    for (let index = 1; index < ids.length; index += 1) {
      raw.exec(
        `INSERT INTO calendar_event_link (id, from_matter_event_id, to_matter_event_id, kind, created_at)
           VALUES ('calendarEventLink_deep${String(index).padStart(11, "0")}', '${ids[index]}', '${ids[index - 1]}', 'continuance_of', '2026-08-07T00:00:00.000Z')`,
      );
    }
    await expect(readContinuanceChain(database, ids[0] as MatterEventId, options)).rejects.toThrow(
      CalendarValidationError,
    );
    await expect(readContinuanceChain(database, ids[0] as MatterEventId, options)).rejects.toThrow(
      /corrupt/,
    );
  });
});
