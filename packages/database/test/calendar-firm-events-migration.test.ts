import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "../src/node-sqlite.ts";

// The calendar's second scope, proven at the schema: every check constraint rejects its bad case,
// the two partial unique indexes hold a continuance chain to a chain under direct SQL (the service
// refuses first, but the schema is the backstop that holds under racing writes), and the whole
// migration is additive — no shipped table is rebuilt, because the additive-only lineage is exactly
// why firm_event is its own table rather than a nullable matter_id.

const MIGRATION = readFileSync(
  join(
    import.meta.dirname,
    "..",
    "drizzle",
    "per-firm",
    "20260807T070000_calendar-firm-events-resources-links.sql",
  ),
  "utf8",
);

const NOW = "'2026-08-07T08:00:00.000Z'";

function migrated() {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_calendarSchema', 'Schema Tester', 'active', ${NOW})`,
  );
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, opened_at, created_at, updated_at)
       VALUES ('matter_calendarSchema0000000000000', 'Smith v Jones', 'open', 'user_calendarSchema', ${NOW}, ${NOW}, ${NOW})`,
  );
  return raw;
}

function insertFirmEvent(raw: ReturnType<typeof migrated>, id: string, columns = "", values = "") {
  raw.exec(
    `INSERT INTO firm_event (id, title, starts_on, time_zone, recorded_at, created_at, updated_at${columns})
       VALUES ('${id}', 'All hands', '2026-09-01', 'America/Denver', ${NOW}, ${NOW}, ${NOW}${values})`,
  );
}

function insertMatterEvent(raw: ReturnType<typeof migrated>, id: string) {
  raw.exec(
    `INSERT INTO matter_event (id, matter_id, title, starts_on, time_zone, recorded_at, created_at, updated_at)
       VALUES ('${id}', 'matter_calendarSchema0000000000000', 'Hearing', '2026-09-14', 'America/Los_Angeles', ${NOW}, ${NOW}, ${NOW})`,
  );
}

describe("firm_event", () => {
  it("accepts the good shape and rejects each bad one", () => {
    const raw = migrated();
    insertFirmEvent(raw, "firmEvent_good0000000000000000000");
    // Empty title.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_event (id, title, starts_on, time_zone, recorded_at, created_at, updated_at)
           VALUES ('firmEvent_badTitle000000000000000', '', '2026-09-01', 'America/Denver', ${NOW}, ${NOW}, ${NOW})`,
      ),
    ).toThrow();
    // A status outside the vocabulary.
    expect(() =>
      insertFirmEvent(raw, "firmEvent_badStatus00000000000000", ", status", ", 'missed'"),
    ).toThrow();
    // An audience outside the vocabulary.
    expect(() =>
      insertFirmEvent(raw, "firmEvent_badAudience000000000000", ", audience", ", 'everyone'"),
    ).toThrow();
    // A date that is not a civil date.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_event (id, title, starts_on, time_zone, recorded_at, created_at, updated_at)
           VALUES ('firmEvent_badDate0000000000000000', 'All hands', '2026-09-01T00:00:00.000Z', 'America/Denver', ${NOW}, ${NOW}, ${NOW})`,
      ),
    ).toThrow();
    // An end before its start.
    expect(() =>
      insertFirmEvent(raw, "firmEvent_badRange000000000000000", ", ends_on", ", '2026-08-31'"),
    ).toThrow();
    // An end time with no start time.
    expect(() =>
      insertFirmEvent(raw, "firmEvent_badEndTime0000000000000", ", ends_at_time", ", '16:30'"),
    ).toThrow();
    // An empty zone.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_event (id, title, starts_on, time_zone, recorded_at, created_at, updated_at)
           VALUES ('firmEvent_badZone0000000000000000', 'All hands', '2026-09-01', '', ${NOW}, ${NOW}, ${NOW})`,
      ),
    ).toThrow();
  });

  it("defaults audience to participants and status to scheduled", () => {
    const raw = migrated();
    insertFirmEvent(raw, "firmEvent_defaults000000000000000");
    const row = raw
      .prepare("SELECT status, audience FROM firm_event WHERE id = ?")
      .get("firmEvent_defaults000000000000000") as { status: string; audience: string };
    expect(row).toEqual({ status: "scheduled", audience: "participants" });
  });
});

describe("firm_event_participant", () => {
  it("requires the kind to name a populated column", () => {
    const raw = migrated();
    insertFirmEvent(raw, "firmEvent_participants00000000000");
    raw.exec(
      `INSERT INTO firm_event_participant (id, firm_event_id, participant_kind, member_user_id, created_at, updated_at)
         VALUES ('firmEventParticipant_member000000', 'firmEvent_participants00000000000', 'member', 'user_calendarSchema', ${NOW}, ${NOW})`,
    );
    // A member participant with no member column.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_event_participant (id, firm_event_id, participant_kind, participant_name, created_at, updated_at)
           VALUES ('firmEventParticipant_badMember000', 'firmEvent_participants00000000000', 'member', 'Somebody', ${NOW}, ${NOW})`,
      ),
    ).toThrow();
    // An external participant with no name.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_event_participant (id, firm_event_id, participant_kind, created_at, updated_at)
           VALUES ('firmEventParticipant_badExtern000', 'firmEvent_participants00000000000', 'external', ${NOW}, ${NOW})`,
      ),
    ).toThrow();
  });
});

describe("firm_resource", () => {
  it("holds the closed kind set, a positive capacity, and a unique name", () => {
    const raw = migrated();
    raw.exec(
      `INSERT INTO firm_resource (id, name, kind, capacity, created_at, updated_at)
         VALUES ('firmResource_roomA000000000000000', 'Conference Room A', 'room', 10, ${NOW}, ${NOW})`,
    );
    expect(() =>
      raw.exec(
        `INSERT INTO firm_resource (id, name, kind, created_at, updated_at)
           VALUES ('firmResource_badKind0000000000000', 'The lobby', 'lobby', ${NOW}, ${NOW})`,
      ),
    ).toThrow();
    expect(() =>
      raw.exec(
        `INSERT INTO firm_resource (id, name, kind, capacity, created_at, updated_at)
           VALUES ('firmResource_badCapacity000000000', 'Broom closet', 'room', 0, ${NOW}, ${NOW})`,
      ),
    ).toThrow();
    // The unique name: two rooms called the same thing are one room nobody can book on purpose.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_resource (id, name, kind, created_at, updated_at)
           VALUES ('firmResource_duplicate00000000000', 'Conference Room A', 'room', ${NOW}, ${NOW})`,
      ),
    ).toThrow();
  });
});

describe("firm_resource_booking", () => {
  it("attaches to exactly one event, never zero and never two", () => {
    const raw = migrated();
    insertFirmEvent(raw, "firmEvent_booked00000000000000000");
    insertMatterEvent(raw, "matterEvent_booked000000000000000");
    raw.exec(
      `INSERT INTO firm_resource (id, name, kind, created_at, updated_at)
         VALUES ('firmResource_bookable000000000000', 'Pool car', 'vehicle', ${NOW}, ${NOW})`,
    );
    const bookingColumns =
      "id, resource_id, matter_event_id, firm_event_id, starts_on, time_zone, recorded_at, created_at, updated_at";
    raw.exec(
      `INSERT INTO firm_resource_booking (${bookingColumns})
         VALUES ('firmResourceBooking_firm000000000', 'firmResource_bookable000000000000', NULL, 'firmEvent_booked00000000000000000', '2026-09-01', 'America/Denver', ${NOW}, ${NOW}, ${NOW})`,
    );
    // Neither event.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_resource_booking (${bookingColumns})
           VALUES ('firmResourceBooking_neither000000', 'firmResource_bookable000000000000', NULL, NULL, '2026-09-01', 'America/Denver', ${NOW}, ${NOW}, ${NOW})`,
      ),
    ).toThrow();
    // Both events.
    expect(() =>
      raw.exec(
        `INSERT INTO firm_resource_booking (${bookingColumns})
           VALUES ('firmResourceBooking_both000000000', 'firmResource_bookable000000000000', 'matterEvent_booked000000000000000', 'firmEvent_booked00000000000000000', '2026-09-01', 'America/Denver', ${NOW}, ${NOW}, ${NOW})`,
      ),
    ).toThrow();
  });
});

describe("calendar_event_link", () => {
  const linkColumns =
    "id, from_matter_event_id, from_firm_event_id, to_matter_event_id, to_firm_event_id, kind, created_at";

  it("requires exactly one column per end and confines continuance_of to matter events", () => {
    const raw = migrated();
    insertMatterEvent(raw, "matterEvent_linkFrom0000000000000");
    insertMatterEvent(raw, "matterEvent_linkTo000000000000000");
    insertFirmEvent(raw, "firmEvent_linked00000000000000000");
    raw.exec(
      `INSERT INTO calendar_event_link (${linkColumns})
         VALUES ('calendarEventLink_related00000000', 'matterEvent_linkFrom0000000000000', NULL, NULL, 'firmEvent_linked00000000000000000', 'related', ${NOW})`,
    );
    // An end with both columns set.
    expect(() =>
      raw.exec(
        `INSERT INTO calendar_event_link (${linkColumns})
           VALUES ('calendarEventLink_badEnd000000000', 'matterEvent_linkFrom0000000000000', 'firmEvent_linked00000000000000000', 'matterEvent_linkTo000000000000000', NULL, 'related', ${NOW})`,
      ),
    ).toThrow();
    // A kind outside the closed set.
    expect(() =>
      raw.exec(
        `INSERT INTO calendar_event_link (${linkColumns})
           VALUES ('calendarEventLink_badKind00000000', 'matterEvent_linkFrom0000000000000', NULL, 'matterEvent_linkTo000000000000000', NULL, 'follows', ${NOW})`,
      ),
    ).toThrow();
    // A continuance with a firm-event end: a moved staff meeting is not procedural history.
    expect(() =>
      raw.exec(
        `INSERT INTO calendar_event_link (${linkColumns})
           VALUES ('calendarEventLink_badScope0000000', NULL, 'firmEvent_linked00000000000000000', 'matterEvent_linkTo000000000000000', NULL, 'continuance_of', ${NOW})`,
      ),
    ).toThrow();
  });

  it("refuses a fork in the continuance chain under direct SQL, in both directions", () => {
    const raw = migrated();
    insertMatterEvent(raw, "matterEvent_settingOne00000000000");
    insertMatterEvent(raw, "matterEvent_settingTwo00000000000");
    insertMatterEvent(raw, "matterEvent_settingThree000000000");
    raw.exec(
      `INSERT INTO calendar_event_link (${linkColumns})
         VALUES ('calendarEventLink_chain0000000000', 'matterEvent_settingTwo00000000000', NULL, 'matterEvent_settingOne00000000000', NULL, 'continuance_of', ${NOW})`,
    );
    // A second successor for setting one: the same hearing continued to two different settings.
    expect(() =>
      raw.exec(
        `INSERT INTO calendar_event_link (${linkColumns})
           VALUES ('calendarEventLink_forkTo000000000', 'matterEvent_settingThree000000000', NULL, 'matterEvent_settingOne00000000000', NULL, 'continuance_of', ${NOW})`,
      ),
    ).toThrow();
    // A second predecessor for setting two: one setting claiming to continue two hearings.
    expect(() =>
      raw.exec(
        `INSERT INTO calendar_event_link (${linkColumns})
           VALUES ('calendarEventLink_forkFrom0000000', 'matterEvent_settingTwo00000000000', NULL, 'matterEvent_settingThree000000000', NULL, 'continuance_of', ${NOW})`,
      ),
    ).toThrow();
    // The partial index binds only the continuance kind: related links carry no chain rule.
    raw.exec(
      `INSERT INTO calendar_event_link (${linkColumns})
         VALUES ('calendarEventLink_relatedTwo00000', 'matterEvent_settingThree000000000', NULL, 'matterEvent_settingOne00000000000', NULL, 'related', ${NOW})`,
    );
  });
});

describe("the migration is additive", () => {
  it("adds status_reason to matter_event without touching any other column", () => {
    const raw = migrated();
    insertMatterEvent(raw, "matterEvent_statusReason000000000");
    raw.exec(
      `UPDATE matter_event SET status = 'cancelled', status_reason = 'Continued on motion' WHERE id = 'matterEvent_statusReason000000000'`,
    );
    const row = raw
      .prepare("SELECT status_reason FROM matter_event WHERE id = ?")
      .get("matterEvent_statusReason000000000") as { status_reason: string };
    expect(row.status_reason).toBe("Continued on motion");
  });

  it("seeds the firm-scope platform vocabulary on the shared catalog", () => {
    const raw = migrated();
    const rows = raw
      .prepare(
        "SELECT name FROM matter_event_type WHERE category = 'firm' AND origin = 'platform' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = rows.map((row) => row.name);
    for (const name of [
      "Firm meeting",
      "Training",
      "Office closure",
      "Firm holiday",
      "Reservation",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("emits no rebuild of any shipped table", () => {
    // Additive only: five CREATE TABLE for new tables, one ALTER TABLE ADD, indexes, and seeds.
    expect(MIGRATION).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION).not.toMatch(/RENAME TO/i);
    const created = [...MIGRATION.matchAll(/CREATE TABLE `([a-z_]+)`/g)].map((match) => match[1]);
    expect(created.toSorted()).toEqual([
      "calendar_event_link",
      "firm_event",
      "firm_event_participant",
      "firm_resource",
      "firm_resource_booking",
    ]);
    const altered = [...MIGRATION.matchAll(/ALTER TABLE `([a-z_]+)` ADD/g)].map(
      (match) => match[1],
    );
    expect(altered).toEqual(["matter_event"]);
  });
});
