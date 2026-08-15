import { describe, expect, it } from "vitest";
import { continueMatterEvent } from "../src/continuance-service.ts";
import { cancelMatterEvent, createMatterEvent, updateMatterEvent } from "../src/event-service.ts";
import {
  CALENDAR_EVENT_CANCELLED_TOPIC,
  CALENDAR_EVENT_RESCHEDULED_TOPIC,
  CALENDAR_EVENT_SCHEDULED_TOPIC,
  CALENDAR_NOTIFICATION_EMISSION_POINTS,
  CALENDAR_OUTBOX_TOPICS,
} from "../src/notifications.ts";
import { MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// What the matter-event write paths ANNOUNCE. The rows they write are covered by
// event-service.test.ts and link-and-continuance.test.ts; this file is only about the outbox
// messages that ride the same batch, because those are a contract with a subscriber that lives in
// another package and cannot be read from here.

const HEARING = {
  matterId: MATTER,
  title: "Hearing on the motion to compel",
  startsOn: "2026-09-14",
  startsAtTime: "09:00",
  timeZone: "America/Los_Angeles",
  locationText: "Department 12",
  courtReference: "A-26-123456-C",
} as const;

function topics(messages: readonly { readonly topic: string }[]): string[] {
  return messages.map((message) => message.topic);
}

async function recordHearing(database: ReturnType<typeof migratedDatabase>["database"]) {
  const { eventId, effect } = createMatterEvent(database, HEARING, options);
  await commit(database, effect);
  return { eventId, effect };
}

describe("the matter-event write paths announce themselves", () => {
  it("spells every announced topic from the declared emission points", () => {
    // One spelling, not two. An unrecognized topic on the per-firm bus is acked and ignored by
    // design, so a producer and a subscriber that disagree do not throw — delivery just stops.
    for (const topic of CALENDAR_OUTBOX_TOPICS) {
      expect(CALENDAR_NOTIFICATION_EMISSION_POINTS as readonly string[]).toContain(topic);
    }
  });

  it("raises scheduled when a setting is recorded, carrying identifiers only", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId, effect } = await recordHearing(database);

    expect(topics(effect.outboxMessages)).toEqual([CALENDAR_EVENT_SCHEDULED_TOPIC]);
    // The payload is the two handles and nothing else. The title on this fixture is a hearing
    // description and the court reference is a case number; a message that carried either would put
    // both on a queue and then into a notification row that outlives the access check for it.
    expect(effect.outboxMessages[0]?.payload).toEqual({
      matterEventId: eventId,
      matterId: MATTER,
    });
  });

  it("raises rescheduled when the setting moves", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    const { effect } = await updateMatterEvent(
      database,
      eventId,
      { startsOn: "2026-10-05" },
      options,
    );
    expect(topics(effect.outboxMessages)).toEqual([CALENDAR_EVENT_RESCHEDULED_TOPIC]);
  });

  it("raises rescheduled when only the hour moves", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    const { effect } = await updateMatterEvent(
      database,
      eventId,
      { startsAtTime: "13:30" },
      options,
    );
    expect(topics(effect.outboxMessages)).toEqual([CALENDAR_EVENT_RESCHEDULED_TOPIC]);
  });

  it("raises rescheduled when only the zone moves", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    // Same wall clock, different court: the hearing is at a different INSTANT, which is a move.
    const { effect } = await updateMatterEvent(
      database,
      eventId,
      { timeZone: "America/New_York" },
      options,
    );
    expect(topics(effect.outboxMessages)).toEqual([CALENDAR_EVENT_RESCHEDULED_TOPIC]);
  });

  it("stays quiet when an edit does not move the setting", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    // A title correction and a room change. Announcing a reschedule for either would tell a team a
    // hearing moved when it did not, and the notification is the one thing a reader acts on without
    // opening the record.
    const { effect } = await updateMatterEvent(
      database,
      eventId,
      { title: "Hearing on the motion to compel discovery", locationText: "Department 14" },
      options,
    );
    expect(effect.outboxMessages).toEqual([]);
  });

  it("stays quiet when a patch repeats the dates it already has", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    const { effect } = await updateMatterEvent(
      database,
      eventId,
      { startsOn: HEARING.startsOn, startsAtTime: HEARING.startsAtTime },
      options,
    );
    expect(effect.outboxMessages).toEqual([]);
  });

  it("raises cancelled when a setting is cancelled", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    const { effect } = await cancelMatterEvent(database, eventId, options, "vacated by the court");
    expect(topics(effect.outboxMessages)).toEqual([CALENDAR_EVENT_CANCELLED_TOPIC]);
    expect(effect.outboxMessages[0]?.payload).toEqual({
      matterEventId: eventId,
      matterId: MATTER,
    });
  });

  it("raises ONE rescheduled for a continuance, naming the new setting", async () => {
    const { database, raw } = migratedDatabase();
    seedMatters(raw);
    const { eventId } = await recordHearing(database);

    const result = await continueMatterEvent(
      database,
      eventId,
      { startsOn: "2026-11-02", statusReason: "Continued on defendant's motion" },
      options,
    );

    // The batch cancels a row and inserts another, but ONE real-world thing happened: the hearing
    // moved. Announcing a cancellation plus a new setting would tell a team the hearing is off and
    // then that some different hearing exists.
    expect(topics(result.effect.outboxMessages)).toEqual([CALENDAR_EVENT_RESCHEDULED_TOPIC]);
    expect(result.effect.outboxMessages[0]?.payload).toEqual({
      matterEventId: result.newEventId,
      matterId: MATTER,
    });
    expect(result.newEventId).not.toBe(eventId);
  });
});
