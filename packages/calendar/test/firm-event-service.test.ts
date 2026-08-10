import { describe, expect, it } from "vitest";
import type { FirmEventId, MatterEventTypeId } from "@magna-carta/identifiers/types";
import { cancelFirmEvent, createFirmEvent, updateFirmEvent } from "../src/firm-event-service.ts";
import { readFirmEvent, readFirmEventParticipants } from "../src/firm-event-statements.ts";
import { CalendarValidationError } from "../src/validation.ts";
import {
  ACTOR,
  RENO_OFFICE,
  SECOND_MEMBER,
  commit,
  migratedDatabase,
  options,
  seedMatters,
  seedOffices,
  seedSecondMember,
} from "./support.ts";

// The firm's own scope: the matter-event service shapes parameterized over the firm_event table.
// Same civil dates, same optional times, same required zone — and the audience switch that makes a
// firm-wide entry possible without enumerating members.

function seeded() {
  const context = migratedDatabase();
  seedMatters(context.raw);
  seedSecondMember(context.raw);
  seedOffices(context.raw);
  return context;
}

describe("recording what the firm schedules for itself", () => {
  it("records a firm meeting with members and an external speaker, defaulting the audience to participants", async () => {
    const { database } = seeded();
    const created = await createFirmEvent(
      database,
      {
        title: "Continuing legal education: trust accounting",
        startsOn: "2026-09-10",
        startsAtTime: "12:00",
        endsAtTime: "13:30",
        timeZone: "America/Los_Angeles",
        locationId: RENO_OFFICE,
        participants: [
          { participantKind: "member", memberUserId: ACTOR },
          { participantKind: "member", memberUserId: SECOND_MEMBER },
          { participantKind: "external", participantName: "Visiting CLE speaker", role: "speaker" },
        ],
      },
      options,
    );
    await commit(database, created.effect);

    const row = await readFirmEvent(database, created.firmEventId);
    expect(row?.status).toBe("scheduled");
    expect(row?.audience).toBe("participants");
    expect(row?.location_id).toBe(RENO_OFFICE);
    const participants = await readFirmEventParticipants(database, created.firmEventId);
    expect(participants).toHaveLength(3);
    expect(participants.map((participant) => participant.participant_kind).sort()).toEqual([
      "external",
      "member",
      "member",
    ]);
  });

  it("records an all-members closure with no participant rows at all", async () => {
    const { database } = seeded();
    const created = await createFirmEvent(
      database,
      {
        title: "Office closed — statewide holiday",
        startsOn: "2026-10-30",
        timeZone: "America/Los_Angeles",
        audience: "all_members",
      },
      options,
    );
    await commit(database, created.effect);
    const row = await readFirmEvent(database, created.firmEventId);
    expect(row?.audience).toBe("all_members");
    expect(await readFirmEventParticipants(database, created.firmEventId)).toHaveLength(0);
  });

  it("holds the event shape rules: range, end-time-needs-start-time, resolvable zone", async () => {
    const { database } = seeded();
    await expect(
      createFirmEvent(
        database,
        {
          title: "Backwards",
          startsOn: "2026-09-10",
          endsOn: "2026-09-09",
          timeZone: "America/Denver",
        },
        options,
      ),
    ).rejects.toThrow(CalendarValidationError);
    await expect(
      createFirmEvent(
        database,
        {
          title: "All day until 4",
          startsOn: "2026-09-10",
          endsAtTime: "16:00",
          timeZone: "America/Denver",
        },
        options,
      ),
    ).rejects.toThrow(/end time needs a start time/);
    await expect(
      createFirmEvent(
        database,
        { title: "Nowhere", startsOn: "2026-09-10", timeZone: "Mars/Olympus_Mons" },
        options,
      ),
    ).rejects.toThrow(/IANA identifier/);
  });

  it("edits in place, replaces the participant set only when one is supplied, and audits the move", async () => {
    const { database, raw } = seeded();
    const created = await createFirmEvent(
      database,
      {
        title: "Quarterly all-hands",
        startsOn: "2026-09-01",
        startsAtTime: "09:00",
        timeZone: "America/Los_Angeles",
        participants: [{ participantKind: "member", memberUserId: ACTOR }],
      },
      options,
    );
    await commit(database, created.effect);

    // A patch with no participants leaves the list alone.
    const moved = await updateFirmEvent(
      database,
      created.firmEventId,
      { startsOn: "2026-09-08", audience: "all_members" },
      options,
    );
    await commit(database, moved.effect);
    expect(await readFirmEventParticipants(database, created.firmEventId)).toHaveLength(1);
    const row = await readFirmEvent(database, created.firmEventId);
    expect(row?.starts_on).toBe("2026-09-08");
    expect(row?.audience).toBe("all_members");

    // A patch WITH participants replaces the whole set.
    const replaced = await updateFirmEvent(
      database,
      created.firmEventId,
      { participants: [{ participantKind: "member", memberUserId: SECOND_MEMBER }] },
      options,
    );
    await commit(database, replaced.effect);
    const participants = await readFirmEventParticipants(database, created.firmEventId);
    expect(participants).toHaveLength(1);
    expect(participants[0]?.member_user_id).toBe(SECOND_MEMBER);

    // The audit rows carry identifiers and dates, never the title.
    const audits = raw
      .prepare("SELECT event, metadata FROM audit_log WHERE event LIKE 'calendar.firmEvent.%'")
      .all() as { event: string; metadata: string | null }[];
    expect(audits.map((entry) => entry.event)).toContain("calendar.firmEvent.updated");
    for (const entry of audits) {
      expect(entry.metadata ?? "").not.toContain("Quarterly all-hands");
    }
  });

  it("cancels with an optional reason and refuses an unknown firm event by name", async () => {
    const { database } = seeded();
    const created = await createFirmEvent(
      database,
      { title: "Retreat planning", startsOn: "2026-09-20", timeZone: "America/Los_Angeles" },
      options,
    );
    await commit(database, created.effect);
    const cancelled = await cancelFirmEvent(
      database,
      created.firmEventId,
      options,
      "Postponed to the spring",
    );
    await commit(database, cancelled.effect);
    const row = await readFirmEvent(database, created.firmEventId);
    expect(row?.status).toBe("cancelled");
    expect(row?.status_reason).toBe("Postponed to the spring");

    await expect(
      cancelFirmEvent(database, "firmEvent_doesNotExist00000000000" as FirmEventId, options),
    ).rejects.toThrow(/no such firm event/);
  });

  // The catalog is shared with matter events and `category` is the only thing separating the two
  // scopes, so the pairing is held at composition: a staff meeting typed "Hearing" would file itself
  // as procedural history on every surface that groups by category.
  const FIRM_MEETING_TYPE = "matterEventType_firmMeeting0000000000" as MatterEventTypeId;
  const HEARING_TYPE = "matterEventType_hearing00000000000000" as MatterEventTypeId;

  it("takes a firm-category event type", async () => {
    const { database } = seeded();
    const created = await createFirmEvent(
      database,
      {
        title: "Monthly partners' meeting",
        eventTypeId: FIRM_MEETING_TYPE,
        startsOn: "2026-09-03",
        timeZone: "America/Los_Angeles",
      },
      options,
    );
    await commit(database, created.effect);
    expect((await readFirmEvent(database, created.firmEventId))?.event_type_id).toBe(
      FIRM_MEETING_TYPE,
    );

    const retyped = await updateFirmEvent(
      database,
      created.firmEventId,
      { eventTypeId: "matterEventType_training0000000000000" as MatterEventTypeId },
      options,
    );
    await commit(database, retyped.effect);
    expect((await readFirmEvent(database, created.firmEventId))?.event_type_id).toBe(
      "matterEventType_training0000000000000",
    );
  });

  it("refuses a litigation-category event type by name, on create and on edit", async () => {
    const { database } = seeded();
    await expect(
      createFirmEvent(
        database,
        {
          title: "All-hands",
          eventTypeId: HEARING_TYPE,
          startsOn: "2026-09-03",
          timeZone: "America/Los_Angeles",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "calendar-event-type-category-mismatch" });

    const created = await createFirmEvent(
      database,
      {
        title: "All-hands",
        eventTypeId: FIRM_MEETING_TYPE,
        startsOn: "2026-09-03",
        timeZone: "America/Los_Angeles",
      },
      options,
    );
    await commit(database, created.effect);
    await expect(
      updateFirmEvent(database, created.firmEventId, { eventTypeId: HEARING_TYPE }, options),
    ).rejects.toMatchObject({ code: "calendar-event-type-category-mismatch" });
    // The refused edit changed nothing.
    expect((await readFirmEvent(database, created.firmEventId))?.event_type_id).toBe(
      FIRM_MEETING_TYPE,
    );
  });
});
