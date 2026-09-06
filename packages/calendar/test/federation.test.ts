import { describe, expect, it } from "vitest";
import { assertCanonicalInstant } from "../src/merge.ts";
import { readTimelinePage } from "../src/timeline.ts";
import { timelineSourceRegistry, MATTER_LIFECYCLE_EVENT_KEYS } from "../src/sources/all.ts";
import { visibleMatterPredicate, visibleMatterPredicateExcluding } from "../src/visibility.ts";
import {
  ACTOR,
  HOLDING_MATTER,
  MATTER,
  WALLED_MATTER,
  migratedDatabase,
  seedMatters,
} from "./support.ts";

// The federated read against real rows. Nothing here was projected, copied, or backfilled: every
// entry is read in place out of the table its own subsystem wrote.

type Raw = ReturnType<typeof migratedDatabase>["raw"];

function seedCorpus(raw: Raw): void {
  seedMatters(raw);
  const at = (day: string) => `2026-0${day}T10:00:00.000Z`;

  // Two recorded events and a deadline on the matter under test.
  raw.exec(`
    INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, time_zone, recorded_at, created_at, updated_at)
      VALUES ('matterEvent_hearing00000000000000', '${MATTER}', 'Hearing on the motion', 'scheduled', '2026-09-14', '09:00', 'America/Los_Angeles', '${at("8-06")}', '${at("8-06")}', '${at("8-06")}');
    INSERT INTO matter_event (id, matter_id, title, status, starts_on, time_zone, recorded_at, created_at, updated_at)
      VALUES ('matterEvent_filing000000000000000', '${MATTER}', 'Complaint filed', 'occurred', '2026-03-02', 'America/Los_Angeles', '${at("3-02")}', '${at("3-02")}', '${at("3-02")}');
    INSERT INTO matter_deadline (id, matter_id, title, due_on, time_zone, source, state, recorded_at, created_at, updated_at)
      VALUES ('matterDeadline_opposition00000000', '${MATTER}', 'Opposition due', '2026-09-07', 'America/Los_Angeles', 'member', 'open', '${at("8-06")}', '${at("8-06")}', '${at("8-06")}');
    INSERT INTO matter_event (id, matter_id, title, status, starts_on, time_zone, recorded_at, created_at, updated_at)
      VALUES ('matterEvent_walled000000000000000', '${WALLED_MATTER}', 'Estate conference', 'scheduled', '2026-09-15', 'America/Los_Angeles', '${at("8-06")}', '${at("8-06")}', '${at("8-06")}');
    INSERT INTO matter_event (id, matter_id, title, status, starts_on, time_zone, recorded_at, created_at, updated_at)
      VALUES ('matterEvent_holding00000000000000', '${HOLDING_MATTER}', 'Holding matter event', 'scheduled', '2026-09-16', 'America/Los_Angeles', '${at("8-06")}', '${at("8-06")}', '${at("8-06")}');
  `);

  // A document on the matter file.
  raw.exec(
    `INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at) VALUES ('file_complaint00000000000000000', '${MATTER}', 'complaint.pdf', 'idle', '${at("3-02")}', '${at("3-02")}')`,
  );

  // Time and costs — the densest sources by row count, registered rather than omitted.
  raw.exec(
    `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, status, source, created_at, updated_at)
       VALUES ('timeEntry_drafting0000000000000', '${MATTER}', '${ACTOR}', '2026-04-10', 90, 87, 'Drafted the opposition brief', 1, 'USD', 'draft', 'manual', '${at("4-10")}', '${at("4-10")}')`,
  );
  raw.exec(
    `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
       VALUES ('costEntry_filingFee00000000000', '${MATTER}', '2026-03-02', 27000, 'USD', 'hard', 1, 'filing fee', 'draft', 'manual', '${at("3-02")}', '${at("3-02")}')`,
  );

  // A conflicts check run against the matter.
  raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at)
       VALUES ('conflictsCheck_intake0000000000', 'matter_open', '${MATTER}', '[]', '{}', 'balanced', 2, '{}', 0, '${ACTOR}', '${at("1-05")}')`,
  );

  // The matter's own lifecycle, which lives in the audit log and nowhere else — beside a settings
  // change and a permission grant, which are exactly what a timeline over this table must not show.
  raw.exec(`
    INSERT INTO audit_log (id, event, actor_user_id, subject_id, metadata, created_at)
      VALUES ('auditLog_matterOpened0000000000', 'matter.opened', '${ACTOR}', '${MATTER}', NULL, '${at("1-02")}');
    INSERT INTO audit_log (id, event, actor_user_id, subject_id, metadata, created_at)
      VALUES ('auditLog_settingChanged0000000', 'setting.updated', '${ACTOR}', '${MATTER}', NULL, '${at("1-03")}');
    INSERT INTO audit_log (id, event, actor_user_id, subject_id, metadata, created_at)
      VALUES ('auditLog_grantIssued000000000', 'role.permission_granted', '${ACTOR}', '${MATTER}', NULL, '${at("1-04")}');
  `);

  // The custody register: an original moved on the matter, BACK-DATED — typed on a Monday for the
  // Friday it actually happened.
  raw.exec(`
    INSERT INTO custody_location (id, name, kind, status, created_at, updated_at)
      VALUES ('custodyLocation_safe00000000000000', 'Reno safe', 'safe', 'active', '${at("1-02")}', '${at("1-02")}');
    INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, matter_id, created_at, updated_at)
      VALUES ('custodyPacket_deeds000000000000000', 'CUS-00042', 'drawn', 'Smith deeds', 'custodyLocation_safe00000000000000', 'held', '${MATTER}', '${at("1-02")}', '${at("1-02")}');
    INSERT INTO custody_movement (id, packet_id, kind, occurred_at, recorded_at, recorded_by_user_id)
      VALUES ('custodyMovement_checkout000000000', 'custodyPacket_deeds000000000000000', 'checked_out', '2026-05-01T16:00:00.000Z', '2026-05-04T09:00:00.000Z', '${ACTOR}');
  `);
}

function readOptions(raw: Raw, database: ReturnType<typeof migratedDatabase>["database"]) {
  return { database, registry: timelineSourceRegistry(), visibility: visibleMatterPredicate() };
}

describe("the matter timeline federates what already exists", () => {
  it("returns one correctly ordered page across every source that has rows", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      pageSize: 50,
    });

    // Newest first, and the order is total across heterogeneous time columns compared as text.
    const sortKeys = page.entries.map((entry) => entry.sortKey);
    expect([...sortKeys].sort().toReversed()).toEqual(sortKeys);

    const sourceKeys = new Set(page.entries.map((entry) => entry.sourceKey));
    expect(sourceKeys).toContain("matterEvent");
    expect(sourceKeys).toContain("matterDeadline");
    expect(sourceKeys).toContain("documentFiled");
    expect(sourceKeys).toContain("timeEntry");
    expect(sourceKeys).toContain("costEntry");
    expect(sourceKeys).toContain("conflictsCheck");
    expect(sourceKeys).toContain("matterLifecycle");
    expect(sourceKeys).toContain("custodyMovement");

    // The read count scales with the REGISTRY, never with the firm's data.
    expect(page.statementCount).toBeLessThanOrEqual(timelineSourceRegistry().all().length + 2);
    expect(page.rowsRead).toBeLessThanOrEqual(page.statementCount * 51);
  });

  it("sorts a custody movement by when it HAPPENED, not by when it was typed", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      pageSize: 50,
    });
    const movement = page.entries.find((entry) => entry.sourceKey === "custodyMovement");
    // occurred_at (the Friday), never recorded_at (the Monday it was typed). This is the assertion
    // the whole federated design rests on: a projection over write-time timestamps would have
    // systematically misdated every physical-world event in the system.
    expect(movement?.sortKey).toBe("2026-05-01T16:00:00.000Z");
  });

  it("carries no privileged content on any entry", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      pageSize: 50,
    });
    const serialized = JSON.stringify(page.entries);
    expect(serialized).not.toContain("Hearing on the motion");
    expect(serialized).not.toContain("Opposition due");
    expect(serialized).not.toContain("Drafted the opposition brief");
    expect(serialized).not.toContain("complaint.pdf");
    expect(serialized).not.toContain("Smith deeds");
  });

  it("says a setting was called off as its own kind, and keeps it on the calendar", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const at = "2026-08-06T10:00:00.000Z";
    raw.exec(`
      INSERT INTO matter_event (id, matter_id, title, status, status_reason, starts_on, time_zone, recorded_at, created_at, updated_at)
        VALUES ('matterEvent_vacated0000000000000', '${MATTER}', 'Vacated hearing', 'cancelled', 'Continued by the court', '2026-09-14', 'America/Los_Angeles', '${at}', '${at}', '${at}');
    `);
    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      sourceKeys: ["matterEvent"],
      pageSize: 50,
    });
    const kinds = new Map(page.entries.map((entry) => [entry.rowId, entry.kind]));
    expect(kinds.get("matterEvent_vacated0000000000000")).toBe("cancelledEvent");
    expect(kinds.get("matterEvent_hearing00000000000000")).toBe("event");
    // The status is a closed word; the reason a person typed stays off the read.
    const vacated = page.entries.find(
      (entry) => entry.rowId === "matterEvent_vacated0000000000000",
    );
    expect(JSON.stringify(vacated)).not.toContain("Continued by the court");
  });

  it("narrows the REGISTRY before building a statement when a kind is filtered", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      sourceKeys: ["matterEvent"],
      pageSize: 50,
    });
    // One source selected means ONE statement issued, not thirteen with twelve discarded.
    expect(page.statementCount).toBe(1);
    expect(page.sourcesRead).toEqual(["matterEvent"]);
    expect(page.entries.every((entry) => entry.sourceKey === "matterEvent")).toBe(true);
  });

  it("refuses a kind filter naming a source the registry does not carry", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    await expect(
      readTimelinePage({
        ...readOptions(raw, database),
        scope: { matterId: MATTER },
        sourceKeys: ["telemetry"],
      }),
    ).rejects.toThrow(/not a timeline source/);
  });

  it("pages through the merged corpus visiting every entry exactly once", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const seen: string[] = [];
    let cursor: { sortKey: string; id: string } | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await readTimelinePage({
        ...readOptions(raw, database),
        scope: { matterId: MATTER },
        pageSize: 2,
        cursor,
      });
      seen.push(...result.entries.map((entry) => `${entry.sourceKey}:${entry.rowId}`));
      if (result.nextCursor === null) break;
      const decoded = JSON.parse(atob(result.nextCursor)) as { c: string; i: string };
      cursor = { sortKey: decoded.c, id: decoded.i };
    }
    // No duplicate and no gap: the walk sees each row once, and sees all of them.
    expect(new Set(seen).size).toBe(seen.length);
    const whole = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      pageSize: 50,
    });
    expect(seen.length).toBe(whole.entries.length);
  });
});

describe("firm events federate onto the firm calendar, never onto a matter's history", () => {
  function seedFirmEvents(raw: Raw): void {
    raw.exec(`
      INSERT INTO firm_event (id, title, status, starts_on, starts_at_time, time_zone, audience, recorded_at, created_at, updated_at)
        VALUES ('firmEvent_allHands000000000000000', 'Quarterly all-hands', 'scheduled', '2026-09-18', '09:00', 'America/Los_Angeles', 'all_members', '2026-08-06T10:00:00.000Z', '2026-08-06T10:00:00.000Z', '2026-08-06T10:00:00.000Z');
      INSERT INTO firm_event (id, title, status, starts_on, time_zone, audience, recorded_at, created_at, updated_at)
        VALUES ('firmEvent_teamMeeting000000000000', 'Listed-members meeting', 'scheduled', '2026-09-21', 'America/Los_Angeles', 'participants', '2026-08-06T10:00:00.000Z', '2026-08-06T10:00:00.000Z', '2026-08-06T10:00:00.000Z');
    `);
  }

  it("interleaves firm events on the firm calendar and keeps them off every matter timeline", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    seedFirmEvents(raw);
    const firmCalendar = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { fromDate: "2026-09-01", toDate: "2026-09-30" },
      pageSize: 50,
    });
    const firmEntries = firmCalendar.entries.filter((entry) => entry.sourceKey === "firmEvent");
    expect(firmEntries).toHaveLength(2);
    // A firm event's entry carries a NULL matter, the catalog-free label, and never the title.
    expect(firmEntries.every((entry) => entry.matterId === null)).toBe(true);
    expect(JSON.stringify(firmEntries)).not.toContain("Quarterly all-hands");

    const timeline = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      pageSize: 100,
    });
    expect(timeline.entries.some((entry) => entry.sourceKey === "firmEvent")).toBe(false);
  });

  it("narrows by anchor scope before any statement is built, exactly as a kind filter does", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    seedFirmEvents(raw);
    const firmOnly = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { fromDate: "2026-09-01", toDate: "2026-09-30" },
      anchorScope: "firm",
      pageSize: 50,
    });
    expect(firmOnly.statementCount).toBe(1);
    expect(firmOnly.sourcesRead).toEqual(["firmEvent"]);
    const matterOnly = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { fromDate: "2026-09-01", toDate: "2026-09-30" },
      anchorScope: "matter",
      pageSize: 50,
    });
    expect(matterOnly.sourcesRead).not.toContain("firmEvent");
  });

  it("answers a member filter with participants OR all_members, composed in SQL", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    seedFirmEvents(raw);
    raw.exec(
      `INSERT INTO firm_event_participant (id, firm_event_id, participant_kind, member_user_id, created_at, updated_at)
         VALUES ('firmEventParticipant_actor0000000', 'firmEvent_teamMeeting000000000000', 'member', '${ACTOR}', '2026-08-06T10:00:00.000Z', '2026-08-06T10:00:00.000Z')`,
    );
    const forActor = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { fromDate: "2026-09-01", toDate: "2026-09-30", memberUserId: ACTOR },
      sourceKeys: ["firmEvent"],
      pageSize: 50,
    });
    // Both: the meeting the member is listed on, and the all-members entry.
    expect(forActor.entries.map((entry) => entry.rowId).sort()).toEqual([
      "firmEvent_allHands000000000000000",
      "firmEvent_teamMeeting000000000000",
    ]);

    const forStranger = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { fromDate: "2026-09-01", toDate: "2026-09-30", memberUserId: "user_notInvited00000" },
      sourceKeys: ["firmEvent"],
      pageSize: 50,
    });
    // The firm holiday is on EVERYONE'S calendar — that is the audience column's point — and the
    // listed-members meeting is not.
    expect(forStranger.entries.map((entry) => entry.rowId)).toEqual([
      "firmEvent_allHands000000000000000",
    ]);
  });
});

describe("the audit log is a source only over its strict allowlist", () => {
  it("shows the three lifecycle events and refuses every other key", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      sourceKeys: ["matterLifecycle"],
      pageSize: 50,
    });
    expect(page.entries.map((entry) => entry.kind)).toEqual(["matter.opened"]);

    // A settings change and a permission grant sit on the SAME subject in the SAME table and never
    // reach the timeline. The log's vocabulary is uncurated by design; the allowlist is what keeps a
    // case history from becoming an activity feed.
    const kinds = page.entries.map((entry) => entry.kind);
    expect(kinds).not.toContain("setting.updated");
    expect(kinds).not.toContain("role.permission_granted");

    // Adding a key is a deliberate change to a frozen constant, not a configuration a caller makes.
    expect(Object.isFrozen(MATTER_LIFECYCLE_EVENT_KEYS)).toBe(true);
    expect([...MATTER_LIFECYCLE_EVENT_KEYS]).toEqual([
      "matter.created",
      "matter.opened",
      "matter.closed",
      "matter.reopened",
    ]);
  });
});

describe("visibility is structural", () => {
  it("keeps the platform-owned holding matter off every read", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const firmCalendar = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { fromDate: "2026-09-01", toDate: "2026-09-30" },
      sourceKeys: ["matterEvent"],
      pageSize: 50,
    });
    expect(firmCalendar.entries.map((entry) => entry.matterId)).not.toContain(HOLDING_MATTER);
    expect(firmCalendar.entries.map((entry) => entry.matterId)).toContain(MATTER);
  });

  it("drops a walled matter from the firm calendar with no source touched", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const scope = { fromDate: "2026-09-01", toDate: "2026-09-30" } as const;
    const open = await readTimelinePage({
      database,
      registry: timelineSourceRegistry(),
      visibility: visibleMatterPredicate(),
      scope,
      sourceKeys: ["matterEvent"],
      pageSize: 50,
    });
    expect(open.entries.map((entry) => entry.matterId)).toContain(WALLED_MATTER);

    // One more clause in the ONE predicate, and every registered source inherits it — no source
    // module changes, no route changes, and no response shape changes.
    const walled = await readTimelinePage({
      database,
      registry: timelineSourceRegistry(),
      visibility: visibleMatterPredicateExcluding([WALLED_MATTER]),
      scope,
      sourceKeys: ["matterEvent"],
      pageSize: 50,
    });
    expect(walled.entries.map((entry) => entry.matterId)).not.toContain(WALLED_MATTER);
    expect(walled.entries.map((entry) => entry.matterId)).toContain(MATTER);
  });
});

describe("the canonical-instant obligation", () => {
  it("every value an instant-shaped source emits is a canonical UTC instant", async () => {
    const { database, raw } = migratedDatabase();
    seedCorpus(raw);
    const registry = timelineSourceRegistry();
    const instantSources = registry
      .all()
      .filter((source) => source.timeColumnShape === "instant")
      .map((source) => source.key);
    expect(instantSources.length).toBeGreaterThan(0);

    const page = await readTimelinePage({
      ...readOptions(raw, database),
      scope: { matterId: MATTER },
      pageSize: 100,
    });
    const checked = page.entries.filter((entry) => instantSources.includes(entry.sourceKey));
    expect(checked.length).toBeGreaterThan(0);
    for (const entry of checked) {
      assertCanonicalInstant(entry.sortKey, `${entry.sourceKey}.${entry.rowId}`);
    }
  });

  it("fails loudly, and explains the consequence, on a variant precision", () => {
    // The hazard, stated as the failure message a person will read at three in the morning: a
    // second-precision instant sorts AFTER a millisecond-precision one because '.' precedes 'Z' in
    // byte order, so the timeline quietly lists events out of order.
    expect(() => assertCanonicalInstant("2026-08-05T09:00:00Z", "someSource.row")).toThrow(
      /REORDERS THE TIMELINE/,
    );
    expect("2026-08-05T09:00:00Z" > "2026-08-05T09:00:00.500Z").toBe(true);
  });
});
