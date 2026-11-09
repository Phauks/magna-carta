import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { CANCEL_CLOSING_GUARD } from "@magna-carta/meetings/meeting-service";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { racingFirmDatabase } from "./support/racing-firm-database.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The case-calendar route surface, driven through the chokepoint over real Miniflare bindings: a
// member records a hearing with a time, a zone, and two participants; records a deadline with the
// authority the firm relies on; satisfies it with the filing that discharged it; reads both back;
// and reads the matter timeline that federates them with everything else already on the matter.
//
// This block seeds its OWN firm. The chokepoint's rate-limit key is `firm:<firmId>`, so a suite that
// makes this many requests would otherwise spend another block's window and start collecting 429s.

let firmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let diaristCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerUserId: UserId;
let readOnlyUserId: UserId;
let matterId: string;
let secondMatterId: string;

const clock = { now: () => new Date().toISOString() };

// A member with no role and one unrelated direct grant — proves the chokepoint refuses
// calendar:manage to a caller who genuinely lacks it, rather than to one with no session at all.
async function mirrorMemberWithUnrelatedGrant(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: clock.now() }).run();
  await database
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "calendar:read", clock.now())
    .run();
}

function authHeaders(cookie: string, idempotencyKey?: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie, key = crypto.randomUUID()) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, key),
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, crypto.randomUUID()),
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function del(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(cookie, crypto.randomUUID()),
  });
}

// A member with `calendar:manage` and nothing else — no role, so no `meetings:host`. No seeded role
// has that shape, and that is the point: the permission split is the thing under test, and a fixture
// that used a seeded role would be testing which keys the seeds happen to pair.
async function mirrorMemberWithDiaryGrants(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: clock.now() }).run();
  for (const permission of ["calendar:read", "calendar:manage", "matters:read"]) {
    await database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
      )
      .bind(newIdentifier("grant"), userId, permission, clock.now())
      .run();
  }
}

async function createMatter(title: string): Promise<string> {
  // Consultation rather than open: the calendar has no interest in a matter's NUMBER, and drawing
  // one would make this block depend on a numbering scheme it does not otherwise need.
  const response = await post("/api/v1/matters", {
    title,
    status: "consultation",
    responsibleMemberId: ownerUserId,
  });
  expect(response.status).toBe(201);
  const { matterId: id } = (await response.json()) as { matterId: string };
  return id;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Calendar Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("calendar-owner@example.com", {
    userName: "Calendar Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Calendar Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("calendar-owner@example.com");

  const readOnly = await seedCredentialedUser("calendar-readonly@example.com", {
    userName: "Calendar Reader",
    firmId,
  });
  await mirrorMemberWithUnrelatedGrant(firmDatabase, readOnly.userId, "Calendar Reader");
  readOnlyUserId = readOnly.userId;
  readOnlyCookie = await signInForSessionCookie("calendar-readonly@example.com");

  const diarist = await seedCredentialedUser("calendar-diarist@example.com", {
    userName: "Calendar Diarist",
    firmId,
  });
  await mirrorMemberWithDiaryGrants(firmDatabase, diarist.userId, "Calendar Diarist");
  diaristCookie = await signInForSessionCookie("calendar-diarist@example.com");

  matterId = await createMatter("Smith v Jones");
  secondMatterId = await createMatter("Brown estate");
});

describe("recording what happens in a case", () => {
  it("records a hearing, its participants, a deadline, and the filing that discharged it", async () => {
    const hearing = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Hearing on the motion to compel",
      startsOn: "2026-09-14",
      startsAtTime: "09:00",
      timeZone: "America/Los_Angeles",
      locationText: "Department 12",
      courtReference: "A-26-123456-C",
      participants: [
        { participantKind: "external", participantName: "Hon. A. Judge", role: "judge" },
        { participantKind: "external", participantName: "R. Opposing", role: "appearing counsel" },
      ],
    });
    expect(hearing.status).toBe(201);
    const { id: eventId } = (await hearing.json()) as { id: string };

    const detail = await get(`/api/v1/events/${eventId}`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      event: { startsAtTime: string; timeZone: string; status: string };
      participants: { role: string }[];
    };
    expect(detailBody.event.startsAtTime).toBe("09:00");
    // The court's zone, which for this firm is not its own.
    expect(detailBody.event.timeZone).toBe("America/Los_Angeles");
    expect(detailBody.participants.map((row) => row.role).toSorted()).toEqual([
      "appearing counsel",
      "judge",
    ]);

    const deadline = await post(`/api/v1/matters/${matterId}/deadlines`, {
      title: "Opposition due",
      dueOn: "2026-09-07",
      dueAtTime: "17:00",
      timeZone: "America/Los_Angeles",
      authorityText: "order entered 14 August 2026",
      triggerEventId: eventId,
    });
    expect(deadline.status).toBe(201);
    const { id: deadlineId } = (await deadline.json()) as { id: string };

    const filing = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Opposition filed",
      startsOn: "2026-09-05",
      timeZone: "America/Los_Angeles",
      status: "occurred",
    });
    const { id: filingId } = (await filing.json()) as { id: string };

    const satisfied = await post(`/api/v1/deadlines/${deadlineId}/satisfy`, {
      satisfyingEventId: filingId,
    });
    expect(satisfied.status).toBe(200);

    // A deadline that is settled is not re-decided.
    const again = await post(`/api/v1/deadlines/${deadlineId}/satisfy`, {});
    expect(again.status).toBe(409);
    const problem = (await again.json()) as { type: string };
    expect(problem.type).toContain("calendar-deadline-settled");

    const events = await get(`/api/v1/matters/${matterId}/events`);
    expect(events.status).toBe(200);
    const eventsBody = (await events.json()) as { data: { id: string }[] };
    expect(eventsBody.data.map((row) => row.id)).toContain(eventId);
  });

  it("names the event's type, and keeps an unclassified one in the list", async () => {
    // A screen cannot render an identifier. The listing resolves the type's NAME beside it, and the
    // join is LEFT so an event classified under nothing is still an event on the matter.
    const catalog = await get("/api/v1/calendar/event-types");
    const catalogBody = (await catalog.json()) as {
      data: { id: string; name: string; code: string | null }[];
    };
    const hearingType = catalogBody.data.find((row) => row.code === "HEARING");
    expect(hearingType).toBeDefined();

    const typedMatterId = await createMatter("Doe conservatorship");
    const classified = await post(`/api/v1/matters/${typedMatterId}/events`, {
      eventTypeId: hearingType?.id,
      title: "Petition heard",
      startsOn: "2027-03-11",
      timeZone: "America/Los_Angeles",
    });
    expect(classified.status).toBe(201);
    const { id: classifiedId } = (await classified.json()) as { id: string };

    const unclassified = await post(`/api/v1/matters/${typedMatterId}/events`, {
      title: "Client called about the hearing",
      startsOn: "2027-03-10",
      timeZone: "America/Los_Angeles",
    });
    expect(unclassified.status).toBe(201);

    const listed = await get(`/api/v1/matters/${typedMatterId}/events`);
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      data: { title: string; eventTypeId: string | null; eventTypeName: string | null }[];
    };
    const byTitle = new Map(listedBody.data.map((row) => [row.title, row]));
    expect(byTitle.get("Petition heard")?.eventTypeName).toBe(hearingType?.name);
    expect(byTitle.get("Client called about the hearing")?.eventTypeId).toBeNull();
    expect(byTitle.get("Client called about the hearing")?.eventTypeName).toBeNull();

    // The single-event read carries the same resolved name, so the two do not disagree.
    const detail = await get(`/api/v1/events/${classifiedId}`);
    const detailBody = (await detail.json()) as { event: { eventTypeName: string | null } };
    expect(detailBody.event.eventTypeName).toBe(hearingType?.name);
  });

  it("moves a continued hearing on the one row rather than adding a second", async () => {
    const created = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Status conference",
      startsOn: "2026-10-01",
      timeZone: "America/Los_Angeles",
    });
    const { id: eventId } = (await created.json()) as { id: string };

    const moved = await patch(`/api/v1/events/${eventId}`, { startsOn: "2026-11-02" });
    expect(moved.status).toBe(200);

    const detail = await get(`/api/v1/events/${eventId}`);
    const body = (await detail.json()) as { event: { startsOn: string } };
    expect(body.event.startsOn).toBe("2026-11-02");

    // Cancelling keeps the record: a hearing that was taken off is a fact about the case.
    const cancelled = await post(`/api/v1/events/${eventId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    const afterCancel = await get(`/api/v1/events/${eventId}`);
    const cancelBody = (await afterCancel.json()) as { event: { status: string } };
    expect(cancelBody.event.status).toBe("cancelled");
  });

  it("refuses the writes to a member who holds only calendar:read", async () => {
    const refused = await post(
      `/api/v1/matters/${matterId}/events`,
      { title: "Not allowed", startsOn: "2026-09-14", timeZone: "America/Los_Angeles" },
      readOnlyCookie,
    );
    expect(refused.status).toBe(403);
    // The read is still open to them: seeing what is coming is a different capability from
    // asserting when a hearing is.
    const allowed = await get(`/api/v1/matters/${matterId}/events`, readOnlyCookie);
    expect(allowed.status).toBe(200);
  });

  it("refuses a deadline sourced from a statutory catalog, because none is encoded", async () => {
    const refused = await post(`/api/v1/matters/${matterId}/deadlines`, {
      title: "Statutory deadline",
      dueOn: "2026-12-01",
      timeZone: "America/Los_Angeles",
      source: "statutory_catalog",
    });
    // Refused at the door by the request contract: the source is not one a caller can name.
    expect(refused.status).toBe(422);
  });

  it("refuses a deadline whose time is not a time of day", async () => {
    // The form's control can only hold a time, but the contract is the door every caller uses. One
    // request: this block's firm shares one rate-limit window, and the range of malformed times is
    // pinned in packages/calendar/test/deadline-service.test.ts.
    const refused = await post(`/api/v1/matters/${matterId}/deadlines`, {
      title: "Opposition due",
      dueOn: "2026-12-01",
      dueAtTime: "5pm",
      timeZone: "America/Los_Angeles",
    });
    expect(refused.status).toBe(422);
  });
});

describe("the matter timeline federates what is already recorded", () => {
  it("returns one ordered page across sources and narrows to one statement per kind filter", async () => {
    await post(`/api/v1/matters/${secondMatterId}/events`, {
      title: "Estate conference",
      startsOn: "2026-09-20",
      timeZone: "America/Los_Angeles",
    });
    await post(`/api/v1/matters/${secondMatterId}/deadlines`, {
      title: "Inventory due",
      dueOn: "2026-10-15",
      timeZone: "America/Los_Angeles",
    });

    const timeline = await get(`/api/v1/matters/${secondMatterId}/timeline`);
    expect(timeline.status).toBe(200);
    const body = (await timeline.json()) as {
      data: { sourceKey: string; sortKey: string; label: string | null; title: string | null }[];
      nextCursor: string | null;
    };
    const sourceKeys = new Set(body.data.map((entry) => entry.sourceKey));
    expect(sourceKeys.has("matterEvent")).toBe(true);
    expect(sourceKeys.has("matterDeadline")).toBe(true);
    // The matter's own opening lives in the audit log and nowhere else, and reaches the timeline
    // over the strict lifecycle allowlist.
    expect(sourceKeys.has("matterLifecycle")).toBe(true);
    // Newest first across heterogeneous time columns compared as text.
    const sortKeys = body.data.map((entry) => entry.sortKey);
    expect([...sortKeys].toSorted().toReversed()).toEqual(sortKeys);
    // The PROJECTION carries no privileged content — a label is a type code or a state, never a
    // title — and the matter-scoped read then NAMES its rows through each source's own describe,
    // behind that source's read capability, which this member holds.
    expect(body.data.every((entry) => entry.label !== "Estate conference")).toBe(true);
    expect(body.data.every((entry) => entry.label !== "Inventory due")).toBe(true);
    expect(body.data.find((entry) => entry.sourceKey === "matterEvent")?.title).toBe(
      "Estate conference",
    );
    expect(body.data.find((entry) => entry.sourceKey === "matterDeadline")?.title).toBe(
      "Inventory due",
    );

    const filtered = await get(`/api/v1/matters/${secondMatterId}/timeline?kind=matterEvent`);
    const filteredBody = (await filtered.json()) as { data: { sourceKey: string }[] };
    expect(filteredBody.data.every((entry) => entry.sourceKey === "matterEvent")).toBe(true);
  });

  it("refuses a kind naming a source the registry does not carry", async () => {
    const refused = await get(`/api/v1/matters/${matterId}/timeline?kind=telemetry`);
    expect(refused.status).toBe(422);
  });
});

describe("the firm calendar and the deadline list", () => {
  it("refuses a window wider than a year rather than quietly narrowing it", async () => {
    const wide = await get("/api/v1/calendar/events?from=2026-01-01&to=2028-01-01");
    expect(wide.status).toBe(422);
    const problem = (await wide.json()) as { type: string; detail: string };
    expect(problem.type).toContain("calendar-window-too-wide");
    // The refusal names the figure and what to do instead, because a caller cannot fix what it
    // cannot see.
    expect(problem.detail).toContain("366");

    const acceptable = await get("/api/v1/calendar/events?from=2026-09-01&to=2026-09-30");
    expect(acceptable.status).toBe(200);
  });

  it("requires the window at all", async () => {
    const missing = await get("/api/v1/calendar/events");
    expect(missing.status).toBe(422);
  });

  it("reports overdue as a derived flag on every deadline, and stores no such column", async () => {
    const created = await post(`/api/v1/matters/${matterId}/deadlines`, {
      title: "Long-past filing",
      dueOn: "2020-01-02",
      timeZone: "America/Los_Angeles",
    });
    expect(created.status).toBe(201);

    const list = await get("/api/v1/calendar/deadlines?overdue=true");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      data: { id: string; dueOn: string; state: string; overdue: boolean }[];
    };
    const overdue = body.data.find((row) => row.dueOn === "2020-01-02");
    expect(overdue?.overdue).toBe(true);
    // Derived, never written: the row itself is still simply open.
    expect(overdue?.state).toBe("open");

    const { results } = await firmDatabase
      .prepare("SELECT state FROM matter_deadline WHERE due_on = '2020-01-02'")
      .all<{ state: string }>();
    expect(results[0]?.state).toBe("open");
  });

  it("keeps a walled matter's events off the firm calendar without changing any source", async () => {
    // Simulated the way an information-barrier overlay will really work: one more clause in the one
    // visible-matter predicate. Here it is exercised through the platform's own system-key
    // exclusion, which is that predicate's only clause today and a genuine filter — the custody
    // holding matter is a real row in every firm and must never appear on a calendar.
    await firmDatabase
      .prepare("UPDATE matter SET system_key = 'calendar-walled-test' WHERE id = ?1")
      .bind(secondMatterId)
      .run();

    const calendar = await get("/api/v1/calendar/events?from=2026-09-01&to=2026-09-30");
    expect(calendar.status).toBe(200);
    const body = (await calendar.json()) as { data: { matterId: string | null }[] };
    expect(body.data.map((entry) => entry.matterId)).not.toContain(secondMatterId);

    await firmDatabase
      .prepare("UPDATE matter SET system_key = NULL WHERE id = ?1")
      .bind(secondMatterId)
      .run();
    const restored = await get("/api/v1/calendar/events?from=2026-09-01&to=2026-09-30");
    const restoredBody = (await restored.json()) as { data: { matterId: string | null }[] };
    expect(restoredBody.data.map((entry) => entry.matterId)).toContain(secondMatterId);
  });
});

describe("the event-type catalog", () => {
  it("ships the platform vocabulary and refuses to let a firm redefine it", async () => {
    const list = await get("/api/v1/calendar/event-types");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      data: { id: string; code: string | null; origin: string }[];
    };
    const hearing = body.data.find((row) => row.code === "HEARING");
    expect(hearing?.origin).toBe("platform");

    const renamed = await patch(`/api/v1/calendar/event-types/${hearing?.id}`, {
      name: "Court appearance",
    });
    expect(renamed.status).toBe(422);
    const problem = (await renamed.json()) as { type: string };
    expect(problem.type).toContain("calendar-platform-type-immutable");

    const own = await post("/api/v1/calendar/event-types", {
      name: "Probate citation return",
      code: "CITATION",
    });
    expect(own.status).toBe(201);
  });
});

describe("the firm's own scope: firm events, rooms, and bookings", () => {
  it("records a firm meeting with two members and an external speaker, and reads it back", async () => {
    const secondMember = await seedCredentialedUser("calendar-second@example.com", {
      userName: "Second Member",
      firmId,
    });
    await mirrorMemberWithOwnerRole(secondMember.userId, "Second Member", firmId);

    const created = await post("/api/v1/firm-events", {
      title: "Continuing legal education: trust accounting",
      startsOn: "2026-09-10",
      startsAtTime: "12:00",
      endsAtTime: "13:30",
      timeZone: "America/Los_Angeles",
      participants: [
        { participantKind: "member", memberUserId: ownerUserId },
        { participantKind: "member", memberUserId: secondMember.userId },
        { participantKind: "external", participantName: "Visiting speaker", role: "speaker" },
      ],
    });
    expect(created.status).toBe(201);
    const { id: firmEventId } = (await created.json()) as { id: string };

    const detail = await get(`/api/v1/firm-events/${firmEventId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      event: { audience: string; status: string };
      participants: { participantKind: string }[];
    };
    expect(body.event.audience).toBe("participants");
    expect(body.participants).toHaveLength(3);
  });

  it("puts an all-members closure on every member's filtered read, and keeps firm events off the matter timeline", async () => {
    const closure = await post("/api/v1/firm-events", {
      title: "Office closed — statewide holiday",
      startsOn: "2026-10-30",
      timeZone: "America/Los_Angeles",
      audience: "all_members",
    });
    expect(closure.status).toBe(201);
    const { id: closureId } = (await closure.json()) as { id: string };

    // A member with NO participant row anywhere still sees the closure on their calendar: that is
    // what the all-members audience is for.
    const readerSession = await get(
      `/api/v1/calendar/events?from=2026-10-01&to=2026-10-31&memberId=${ownerUserId}`,
      readOnlyCookie,
    );
    expect(readerSession.status).toBe(200);
    const filtered = (await readerSession.json()) as {
      data: { sourceKey: string; rowId: string; label: string | null }[];
    };
    const firmEntries = filtered.data.filter((entry) => entry.sourceKey === "firmEvent");
    expect(firmEntries.map((entry) => entry.rowId)).toContain(closureId);
    // The label carries the audience and the catalog term, never the title.
    expect(JSON.stringify(filtered.data)).not.toContain("statewide holiday");

    // A matter timeline never shows a firm event: it belongs to no case.
    const timeline = await get(`/api/v1/matters/${matterId}/timeline`);
    const timelineBody = (await timeline.json()) as { data: { sourceKey: string }[] };
    expect(timelineBody.data.some((entry) => entry.sourceKey === "firmEvent")).toBe(false);

    // The scope filter narrows to the firm side only.
    const firmOnly = await get("/api/v1/calendar/events?from=2026-10-01&to=2026-10-31&scope=firm");
    const firmOnlyBody = (await firmOnly.json()) as { data: { sourceKey: string }[] };
    expect(firmOnlyBody.data.every((entry) => entry.sourceKey === "firmEvent")).toBe(true);
  });

  it("refuses the firm-scope writes to a member who holds only calendar:read", async () => {
    const refused = await post(
      "/api/v1/firm-events",
      { title: "Not allowed", startsOn: "2026-09-14", timeZone: "America/Los_Angeles" },
      readOnlyCookie,
    );
    expect(refused.status).toBe(403);
    const refusedResource = await post(
      "/api/v1/calendar/resources",
      { name: "Not allowed", kind: "room" },
      readOnlyCookie,
    );
    expect(refusedResource.status).toBe(403);
  });

  it("books a room for a hearing, warns on the double-booking, and frees the room by derivation", async () => {
    const room = await post("/api/v1/calendar/resources", {
      name: "Conference Room A",
      kind: "room",
      capacity: 10,
    });
    expect(room.status).toBe(201);
    const { id: roomId } = (await room.json()) as { id: string };

    const hearing = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Deposition of R. Malloy",
      startsOn: "2026-09-21",
      startsAtTime: "09:00",
      endsAtTime: "12:00",
      timeZone: "America/Los_Angeles",
    });
    const { id: hearingId } = (await hearing.json()) as { id: string };

    const booked = await post("/api/v1/resource-bookings", {
      resourceId: roomId,
      matterEventId: hearingId,
      // The setup-time case: the room from half past eight.
      startsAtTime: "08:30",
    });
    expect(booked.status).toBe(201);
    const bookedBody = (await booked.json()) as { id: string; conflicts: unknown[] };
    expect(bookedBody.conflicts).toHaveLength(0);

    // The event's own window lists what it booked: the resource and the span, from the event's
    // side rather than the room's.
    const eventBookings = await get(`/api/v1/events/${hearingId}/bookings`);
    expect(eventBookings.status).toBe(200);
    const eventBookingsBody = (await eventBookings.json()) as {
      data: { id: string; resourceId: string; startsAtTime: string | null }[];
    };
    expect(eventBookingsBody.data).toEqual([
      expect.objectContaining({ id: bookedBody.id, resourceId: roomId, startsAtTime: "08:30" }),
    ]);

    // The room being taken is NEVER a reason a hearing cannot be recorded: the second hearing
    // records, its booking lands, and the conflict is reported rather than refused.
    const second = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Status conference",
      startsOn: "2026-09-21",
      startsAtTime: "10:00",
      endsAtTime: "11:00",
      timeZone: "America/Los_Angeles",
    });
    expect(second.status).toBe(201);
    const { id: secondId } = (await second.json()) as { id: string };
    const doubleBooked = await post("/api/v1/resource-bookings", {
      resourceId: roomId,
      matterEventId: secondId,
    });
    expect(doubleBooked.status).toBe(201);
    const doubleBody = (await doubleBooked.json()) as {
      id: string;
      conflicts: { bookingId: string }[];
    };
    expect(doubleBody.conflicts.map((conflict) => conflict.bookingId)).toContain(bookedBody.id);
    // A conflict is a reference with a window and a link — never a title.
    expect(JSON.stringify(doubleBody.conflicts)).not.toContain("Deposition");

    // The availability grid pre-pairs the overlap.
    const availability = await get(
      `/api/v1/calendar/resources/${roomId}/availability?from=2026-09-01&to=2026-09-30`,
    );
    expect(availability.status).toBe(200);
    const availabilityBody = (await availability.json()) as {
      data: { bookingId: string; overlappingBookingIds: string[]; eventTypeName: string | null }[];
    };
    expect(availabilityBody.data).toHaveLength(2);
    expect(
      availabilityBody.data.find((entry) => entry.bookingId === bookedBody.id)
        ?.overlappingBookingIds,
    ).toContain(doubleBody.id);

    // Cancelling the second hearing frees the room with no second write anywhere.
    const cancelled = await post(`/api/v1/events/${secondId}/cancel`, {
      statusReason: "Off calendar",
    });
    expect(cancelled.status).toBe(200);
    const after = await get(
      `/api/v1/calendar/resources/${roomId}/availability?from=2026-09-01&to=2026-09-30`,
    );
    const afterBody = (await after.json()) as { data: { bookingId: string }[] };
    expect(afterBody.data.map((entry) => entry.bookingId)).toEqual([bookedBody.id]);

    // Deleting the surviving booking is a true delete.
    const deleted = await del(`/api/v1/resource-bookings/${bookedBody.id}`);
    expect(deleted.status).toBe(200);
  });
});

describe("continuance: the record shows what was continued from what", () => {
  it("continues a hearing, reports its deadlines and released bookings, and walks the chain", async () => {
    const hearing = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Hearing on the merits",
      startsOn: "2026-11-09",
      startsAtTime: "09:00",
      timeZone: "America/Los_Angeles",
      participants: [
        { participantKind: "external", participantName: "Hon. A. Judge", role: "judge" },
      ],
    });
    const { id: firstSettingId } = (await hearing.json()) as { id: string };

    const deadline = await post(`/api/v1/matters/${matterId}/deadlines`, {
      title: "Trial brief due",
      dueOn: "2026-11-02",
      timeZone: "America/Los_Angeles",
      triggerEventId: firstSettingId,
    });
    const { id: deadlineId } = (await deadline.json()) as { id: string };

    const room = await post("/api/v1/calendar/resources", {
      name: "War room",
      kind: "room",
    });
    const { id: roomId } = (await room.json()) as { id: string };
    const booking = await post("/api/v1/resource-bookings", {
      resourceId: roomId,
      matterEventId: firstSettingId,
    });
    const { id: bookingId } = (await booking.json()) as { id: string };

    const continued = await post(`/api/v1/events/${firstSettingId}/continue`, {
      startsOn: "2026-12-14",
      statusReason: "Continued on defendant's motion",
    });
    expect(continued.status).toBe(201);
    const continuedBody = (await continued.json()) as {
      newEventId: string;
      oldEventId: string;
      triggerLinkedOpenDeadlines: { id: string; dueOn: string }[];
      releasedBookings: { bookingId: string }[];
    };
    expect(continuedBody.oldEventId).toBe(firstSettingId);
    // The deadline is REPORTED, with its date untouched: nothing moves a date.
    expect(continuedBody.triggerLinkedOpenDeadlines.map((row) => row.id)).toEqual([deadlineId]);
    expect(continuedBody.triggerLinkedOpenDeadlines[0]?.dueOn).toBe("2026-11-02");
    // The booking the status change just released, so the person can re-book at the new time.
    expect(continuedBody.releasedBookings.map((row) => row.bookingId)).toEqual([bookingId]);

    // The old setting: cancelled with the reason, history intact, badge pointing forward.
    const oldDetail = await get(`/api/v1/events/${firstSettingId}`);
    const oldBody = (await oldDetail.json()) as {
      event: {
        status: string;
        statusReason: string | null;
        startsOn: string;
        continuedToEventId: string | null;
      };
      participants: unknown[];
    };
    expect(oldBody.event.status).toBe("cancelled");
    expect(oldBody.event.statusReason).toBe("Continued on defendant's motion");
    expect(oldBody.event.startsOn).toBe("2026-11-09");
    expect(oldBody.event.continuedToEventId).toBe(continuedBody.newEventId);

    // The new setting: scheduled, participants carried, badge pointing back.
    const newDetail = await get(`/api/v1/events/${continuedBody.newEventId}`);
    const newBody = (await newDetail.json()) as {
      event: { status: string; startsOn: string; continuedFromEventId: string | null };
      participants: unknown[];
    };
    expect(newBody.event.status).toBe("scheduled");
    expect(newBody.event.startsOn).toBe("2026-12-14");
    expect(newBody.event.continuedFromEventId).toBe(firstSettingId);
    expect(newBody.participants).toHaveLength(1);

    // A second continuance of the SAME setting is refused by name; the chain continues from the end.
    const refused = await post(`/api/v1/events/${firstSettingId}/continue`, {
      startsOn: "2027-01-11",
    });
    expect(refused.status).toBe(409);
    const refusedProblem = (await refused.json()) as { type: string };
    expect(refusedProblem.type).toContain("calendar-event-not-continuable");

    const secondContinuance = await post(`/api/v1/events/${continuedBody.newEventId}/continue`, {
      startsOn: "2027-01-11",
      statusReason: "Continued again",
    });
    expect(secondContinuance.status).toBe(201);
    const thirdSetting = (await secondContinuance.json()) as { newEventId: string };

    // The chain read walks the whole path in order from the MIDDLE node.
    const chain = await get(`/api/v1/events/${continuedBody.newEventId}/continuance-chain`);
    expect(chain.status).toBe(200);
    const chainBody = (await chain.json()) as {
      data: { eventId: string; status: string; statusReason: string | null }[];
    };
    expect(chainBody.data.map((node) => node.eventId)).toEqual([
      firstSettingId,
      continuedBody.newEventId,
      thirdSetting.newEventId,
    ]);
    expect(chainBody.data.at(-1)?.status).toBe("scheduled");
  });

  it("relates two events with a link, refuses the duplicate, and refuses deleting a continuance link", async () => {
    const prep = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Prep session",
      startsOn: "2026-11-05",
      timeZone: "America/Los_Angeles",
    });
    const { id: prepId } = (await prep.json()) as { id: string };
    const firmEvent = await post("/api/v1/firm-events", {
      title: "War-room afternoon",
      startsOn: "2026-11-06",
      timeZone: "America/Los_Angeles",
    });
    const { id: firmEventId } = (await firmEvent.json()) as { id: string };

    const linked = await post("/api/v1/event-links", {
      fromMatterEventId: prepId,
      toFirmEventId: firmEventId,
      note: "Prep for the Malloy deposition",
    });
    expect(linked.status).toBe(201);
    const { id: linkId } = (await linked.json()) as { id: string };

    // Both ends list the link, from either side, as identifiers and a note — never a title.
    const fromSide = await get(`/api/v1/events/${prepId}/links`);
    expect(fromSide.status).toBe(200);
    const fromBody = (await fromSide.json()) as {
      data: { id: string; kind: string; from: unknown; to: unknown; note: string | null }[];
    };
    expect(fromBody.data.map((link) => [link.id, link.kind])).toEqual([[linkId, "related"]]);
    expect(fromBody.data[0]).toMatchObject({
      from: { matterEventId: prepId, firmEventId: null },
      to: { matterEventId: null, firmEventId },
      note: "Prep for the Malloy deposition",
    });
    const toSide = await get(`/api/v1/firm-events/${firmEventId}/links`);
    expect(toSide.status).toBe(200);
    const toSideBody = (await toSide.json()) as { data: { id: string }[] };
    expect(toSideBody.data.map((link) => link.id)).toEqual([linkId]);

    const duplicate = await post("/api/v1/event-links", {
      fromFirmEventId: firmEventId,
      toMatterEventId: prepId,
    });
    expect(duplicate.status).toBe(422);

    // Both ends on one side is a malformed link, refused at the door.
    const malformed = await post("/api/v1/event-links", {
      fromMatterEventId: prepId,
      fromFirmEventId: firmEventId,
      toMatterEventId: prepId,
    });
    expect(malformed.status).toBe(422);

    const unlinked = await del(`/api/v1/event-links/${linkId}`);
    expect(unlinked.status).toBe(200);
  });
});

// SCHEDULING: a meeting is a calendar event with a medium on it, so the whole of it is driven here
// through the two event write paths rather than through a scheduling surface of its own.
//
// The room is opened AFTER the event commits, because `createMeeting` reads the event through the
// visibility predicate before it writes — so these assertions are also what holds that ordering: a
// create that answered with a null meeting id would mean the second write never happened.
describe("scheduling a meeting on an event", () => {
  async function meetingRow(
    eventId: string,
    column: "matter_event_id" | "firm_event_id" = "matter_event_id",
  ): Promise<{ id: string; medium: string; status: string; lobby: string } | undefined> {
    const { results } = await firmDatabase
      .prepare(`SELECT id, medium, status, lobby FROM meeting WHERE ${column} = ?1`)
      .bind(eventId)
      .all<{ id: string; medium: string; status: string; lobby: string }>();
    return results[0];
  }

  async function invitations(): Promise<{ payload: string }[]> {
    const { results } = await firmDatabase
      .prepare(
        "SELECT payload FROM outbox WHERE topic = 'calendar.event.meetingScheduled' ORDER BY created_at",
      )
      .all<{ payload: string }>();
    return results;
  }

  it("opens the room the event asked for, with the medium it asked for", async () => {
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Deposition preparation",
      startsOn: "2026-10-05",
      startsAtTime: "10:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    expect(recorded.status).toBe(201);
    const body = (await recorded.json()) as { id: string; meetingId: string | null };
    expect(body.meetingId).not.toBeNull();

    const row = await meetingRow(body.id);
    expect(row?.id).toBe(body.meetingId);
    expect(row?.medium).toBe("video");
    // Scheduled, not live: nobody has walked into it. The first arrival is what makes a room live.
    expect(row?.status).toBe("scheduled");
  });

  it("opens the door the event asked for, and leaves it open when the form did not ask", async () => {
    const waiting = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Settlement conference with a waiting room",
      startsOn: "2026-10-08",
      startsAtTime: "09:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video", lobby: "on" },
    });
    expect(waiting.status).toBe(201);
    const waitingBody = (await waiting.json()) as { id: string };
    expect((await meetingRow(waitingBody.id))?.lobby).toBe("on");

    // OMITTED IS `off`, and it has to be: every meeting scheduled before the door existed was, and
    // a form that did not ask must not quietly put a firm's own colleagues in a queue.
    const open = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Team catch-up with no door",
      startsOn: "2026-10-09",
      startsAtTime: "09:30",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    const openBody = (await open.json()) as { id: string };
    expect((await meetingRow(openBody.id))?.lobby).toBe("off");
  });

  it("records a call as a call, and an event with no meeting as having none", async () => {
    const call = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Call with opposing counsel",
      startsOn: "2026-10-06",
      startsAtTime: "11:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "audio" },
    });
    const callBody = (await call.json()) as { id: string; meetingId: string | null };
    expect((await meetingRow(callBody.id))?.medium).toBe("audio");

    const hearing = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Hearing with no meeting on it",
      startsOn: "2026-10-07",
      timeZone: "America/Los_Angeles",
    });
    const hearingBody = (await hearing.json()) as { id: string; meetingId: string | null };
    // Null rather than absent: "no meeting" and "an older server" must not be the same answer.
    expect(hearingBody.meetingId).toBeNull();
    expect(await meetingRow(hearingBody.id)).toBeUndefined();
  });

  it("opens one room however many times the save is repeated", async () => {
    const key = crypto.randomUUID();
    const first = await post(
      `/api/v1/matters/${matterId}/events`,
      {
        title: "Settlement conference",
        startsOn: "2026-10-08",
        startsAtTime: "14:00",
        timeZone: "America/Los_Angeles",
        meeting: { medium: "video" },
      },
      ownerCookie,
      key,
    );
    const firstBody = (await first.json()) as { id: string; meetingId: string | null };

    // The same attempt, repeated: the record form mints its key per attempt and repeats it on a
    // retry, so the event replays and the meeting step converges on the room already open.
    const retried = await post(
      `/api/v1/matters/${matterId}/events`,
      {
        title: "Settlement conference",
        startsOn: "2026-10-08",
        startsAtTime: "14:00",
        timeZone: "America/Los_Angeles",
        meeting: { medium: "video" },
      },
      ownerCookie,
      key,
    );
    const retriedBody = (await retried.json()) as { id: string; meetingId: string | null };
    expect(retriedBody).toEqual(firstBody);

    // And a correction that asks again gets the same room rather than a second one — the medium is
    // chosen once, because the people already in a room agreed to one thing.
    const corrected = await patch(`/api/v1/events/${firstBody.id}`, {
      startsAtTime: "15:00",
      meeting: { medium: "audio" },
    });
    expect(corrected.status).toBe(200);
    const correctedBody = (await corrected.json()) as { ok: true; meetingId: string | null };
    expect(correctedBody.meetingId).toBe(firstBody.meetingId);
    expect((await meetingRow(firstBody.id))?.medium).toBe("video");
  });

  it("invites the colleagues on the event and nobody else", async () => {
    const before = (await invitations()).length;
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Case strategy",
      startsOn: "2026-10-09",
      startsAtTime: "09:30",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
      participants: [
        { participantKind: "member", memberUserId: readOnlyUserId },
        // The actor is on the event and is not invited to the meeting they just scheduled.
        { participantKind: "member", memberUserId: ownerUserId },
        // Neither of these is a member, and neither has a way into a room yet.
        { participantKind: "external", participantName: "Hon. A. Judge", role: "judge" },
        {
          participantKind: "entity",
          entityId: "directoryPerson_client",
          participantName: "Client",
        },
      ],
    });
    expect(recorded.status).toBe(201);
    const body = (await recorded.json()) as { id: string; meetingId: string | null };

    const raised = await invitations();
    expect(raised).toHaveLength(before + 1);
    const payload = JSON.parse(raised[raised.length - 1]?.payload ?? "{}") as {
      matterEventId: string;
      matterId: string;
      meetingId: string;
      medium: string;
      invitedMemberUserIds: string[];
    };
    expect(payload.invitedMemberUserIds).toEqual([readOnlyUserId]);
    expect(payload).toMatchObject({
      matterEventId: body.id,
      matterId,
      meetingId: body.meetingId,
      medium: "video",
    });
    // Identifiers and one closed label. The title of this event is a statement about the case.
    expect(JSON.stringify(payload)).not.toContain("Case strategy");
  });

  it("raises nothing for an event with no colleague on it but the person scheduling", async () => {
    const before = (await invitations()).length;
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Reading the file",
      startsOn: "2026-10-10",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
      participants: [{ participantKind: "member", memberUserId: ownerUserId }],
    });
    expect(recorded.status).toBe(201);
    expect(await invitations()).toHaveLength(before);
  });

  it("schedules on a firm event too, and raises no invitation for it yet", async () => {
    const before = (await invitations()).length;
    const recorded = await post("/api/v1/firm-events", {
      title: "All-hands",
      startsOn: "2026-10-12",
      startsAtTime: "08:30",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
      participants: [{ participantKind: "member", memberUserId: readOnlyUserId }],
    });
    expect(recorded.status).toBe(201);
    const body = (await recorded.json()) as { id: string; meetingId: string | null };
    expect(body.meetingId).not.toBeNull();
    expect((await meetingRow(body.id, "firm_event_id"))?.medium).toBe("video");
    // `notification_event.subject_kind` has no `firmEvent` value and widening a SQLite CHECK is a
    // rebuild of a table `notification_recipient` points at, so the room exists and the invitation
    // waits on that migration rather than on a decision.
    expect(await invitations()).toHaveLength(before);
  });

  it("ends a scheduled meeting with the event it was on", async () => {
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Mediation that came off",
      startsOn: "2026-10-13",
      startsAtTime: "13:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    const body = (await recorded.json()) as { id: string; meetingId: string | null };

    const cancelled = await post(`/api/v1/events/${body.id}/cancel`, {
      statusReason: "Settled before the date",
    });
    expect(cancelled.status).toBe(200);
    // A room nobody walked into, on a setting that is no longer happening, must not stay openable.
    expect((await meetingRow(body.id))?.status).toBe("ended");
  });

  it("refuses to cancel an event whose meeting is running", async () => {
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Deposition under way",
      startsOn: "2026-10-14",
      startsAtTime: "10:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    const body = (await recorded.json()) as { id: string; meetingId: string | null };
    // People are in the room. Reached by hand rather than by joining, because a join wants the media
    // routing credentials this test pool deliberately does not carry.
    await firmDatabase
      .prepare("UPDATE meeting SET status = 'live', started_at = ?2 WHERE id = ?1")
      .bind(body.meetingId, clock.now())
      .run();

    const refused = await post(`/api/v1/events/${body.id}/cancel`, { statusReason: null });
    expect(refused.status).toBe(409);
    const problem = (await refused.json()) as { type: string; detail: string };
    expect(problem.type).toContain("meeting-in-progress");
    expect(problem.detail).toContain("End the meeting first");

    // And nothing moved: the setting is still on, which is the whole point of refusing rather than
    // cancelling and leaving the room running.
    const detail = await get(`/api/v1/events/${body.id}`);
    const detailBody = (await detail.json()) as { event: { status: string } };
    expect(detailBody.event.status).toBe("scheduled");
  });

  it("closes the room nobody walked into when the sitting is taken off", async () => {
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Preparation that was not needed",
      startsOn: "2026-10-15",
      startsAtTime: "09:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    const body = (await recorded.json()) as { id: string; meetingId: string | null };
    expect((await meetingRow(body.id))?.status).toBe("scheduled");

    expect((await post(`/api/v1/events/${body.id}/cancel`, {})).status).toBe(200);

    // One batch: the setting is off and the room is closed. A room left openable on a sitting that
    // is not happening is the product and the record disagreeing.
    expect((await meetingRow(body.id))?.status).toBe("ended");
    const detail = (await (await get(`/api/v1/events/${body.id}`)).json()) as {
      event: { status: string };
    };
    expect(detail.event.status).toBe("cancelled");
  });
});

// THE WINDOW THE CANCEL'S OWN READ CANNOT SPAN, driven through the real routes.
//
// `meetingClosingWithEvent` decides "scheduled, so end it" a round trip before the batch commits,
// and both endings of that race are reachable in a working deployment: somebody joins the meeting,
// or the host ends it. The seam is the firm-database BINDING, because a route builds its own
// database from it — see the harness for why the shared interleaving helper cannot reach a request.
describe("cancelling an event whose meeting moves underneath it", () => {
  const app = createApp();
  // Joining mints relay credentials, so the two acts that move a meeting underneath a cancel are
  // driven through an environment that carries them. The mint degrades to the public resolution
  // server when the service does not answer, which is what it does here.
  const routed = {
    ...env,
    REALTIME_SFU_APP_ID: "test-realtime-application",
    REALTIME_SFU_APP_SECRET: "test-realtime-secret",
  };

  async function meetingAct(path: string): Promise<Response> {
    return await app.request(
      `https://example.com${path}`,
      {
        method: "POST",
        headers: authHeaders(ownerCookie, crypto.randomUUID()),
        body: JSON.stringify({}),
      },
      routed,
    );
  }

  async function meetingFor(eventId: string): Promise<{ id: string; status: string } | undefined> {
    const { results } = await firmDatabase
      .prepare("SELECT id, status FROM meeting WHERE matter_event_id = ?1")
      .bind(eventId)
      .all<{ id: string; status: string }>();
    return results[0];
  }

  async function scheduledMeetingEvent(title: string): Promise<{ id: string; meetingId: string }> {
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title,
      startsOn: "2026-10-20",
      startsAtTime: "13:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    expect(recorded.status).toBe(201);
    const body = (await recorded.json()) as { id: string; meetingId: string | null };
    return { id: body.id, meetingId: body.meetingId ?? "" };
  }

  /** The cancel, sent through an environment whose firm database opens the window. */
  async function cancelRacing(eventId: string, fire: () => Promise<unknown>) {
    const racing = racingFirmDatabase({ ...env }, CANCEL_CLOSING_GUARD, fire);
    const response = await app.request(
      `https://example.com/api/v1/events/${eventId}/cancel`,
      {
        method: "POST",
        headers: authHeaders(ownerCookie, crypto.randomUUID()),
        body: JSON.stringify({}),
      },
      racing.environment,
    );
    return { response, racing };
  }

  it("refuses the cancel when somebody walks in between the read and the commit", async () => {
    const event = await scheduledMeetingEvent("Settlement conference somebody joined");

    const { response, racing } = await cancelRacing(event.id, async () => {
      const joined = await meetingAct(`/api/v1/meetings/${event.meetingId}/join`);
      expect(joined.status).toBe(200);
    });

    // Without the precondition in the statement's own WHERE, the general ending matches
    // `status <> 'ended'` and this cancel closes the room under the member who just joined it —
    // with the room itself never told, because a cancel notifies nobody.
    expect(racing.interleaved).toBe(true);
    expect(response.status).toBe(409);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("meeting-in-progress");

    // The whole batch rolled back: the meeting is live and the sitting is still on the calendar.
    expect((await meetingFor(event.id))?.status).toBe("live");
    const detail = (await (await get(`/api/v1/events/${event.id}`)).json()) as {
      event: { status: string };
    };
    expect(detail.event.status).toBe("scheduled");
  });

  it("lets the cancel through when the host closed the room in that same window", async () => {
    const event = await scheduledMeetingEvent("Conference the host closed");

    const { response, racing } = await cancelRacing(event.id, async () => {
      const ended = await meetingAct(`/api/v1/meetings/${event.meetingId}/end`);
      expect(ended.status).toBe(200);
    });

    // Nothing is left to close, so the closing is a no-op and the diary act stands on its own —
    // where before the guard's refusal came back to the member as a server error.
    expect(racing.interleaved).toBe(true);
    expect(response.status).toBe(200);
    expect((await meetingFor(event.id))?.status).toBe("ended");
    const detail = (await (await get(`/api/v1/events/${event.id}`)).json()) as {
      event: { status: string };
    };
    expect(detail.event.status).toBe("cancelled");

    // ENDED ONCE. The instant and the actor a record already carries are never moved by the
    // tidy-up that lost the race.
    const { results } = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS endings FROM audit_log WHERE event = 'meetings.meeting.ended' AND subject_id = ?1",
      )
      .bind(event.meetingId)
      .all<{ endings: number }>();
    expect(results[0]?.endings).toBe(1);
  });
});

describe("opening a room from the event form is a meetings act", () => {
  it("refuses the meeting to a member who keeps the diary and may not host, and records the event without one", async () => {
    const refused = await post(
      `/api/v1/matters/${matterId}/events`,
      {
        title: "Meeting the diarist may not convene",
        startsOn: "2026-10-22",
        startsAtTime: "09:00",
        timeZone: "America/Los_Angeles",
        meeting: { medium: "video" },
      },
      diaristCookie,
    );
    expect(refused.status).toBe(403);
    const problem = (await refused.json()) as { type: string };
    expect(problem.type).toContain("permission-denied");

    // THE MEETING FIELD ALONE. Keeping the diary is what `calendar:manage` is for, and the same
    // member records the same sitting without a room on it.
    const recorded = await post(
      `/api/v1/matters/${matterId}/events`,
      {
        title: "The same sitting, without a room",
        startsOn: "2026-10-22",
        startsAtTime: "09:00",
        timeZone: "America/Los_Angeles",
      },
      diaristCookie,
    );
    expect(recorded.status).toBe(201);
    const plain = (await recorded.json()) as { meetingId: string | null };
    expect(plain.meetingId).toBeNull();
  });

  it("still lets that member take a sitting off the calendar, room and all", async () => {
    // The room is the host's; the sitting is the diary's. Requiring the meetings key to cancel
    // would leave a firm unable to take a hearing off because somebody else opened a room on it.
    const recorded = await post(`/api/v1/matters/${matterId}/events`, {
      title: "Hearing the diarist takes off",
      startsOn: "2026-10-23",
      startsAtTime: "11:00",
      timeZone: "America/Los_Angeles",
      meeting: { medium: "video" },
    });
    const body = (await recorded.json()) as { id: string; meetingId: string | null };

    const cancelled = await post(`/api/v1/events/${body.id}/cancel`, {}, diaristCookie);
    expect(cancelled.status).toBe(200);

    const { results } = await firmDatabase
      .prepare("SELECT status FROM meeting WHERE id = ?1")
      .bind(body.meetingId)
      .all<{ status: string }>();
    expect(results[0]?.status).toBe("ended");
  });
});
