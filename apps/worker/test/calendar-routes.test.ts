import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
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
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerUserId: UserId;
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

async function createMatter(title: string): Promise<string> {
  // Prospective rather than open: the calendar has no interest in a matter's NUMBER, and drawing
  // one would make this block depend on a numbering scheme it does not otherwise need.
  const response = await post("/api/v1/matters", {
    title,
    status: "prospective",
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
  readOnlyCookie = await signInForSessionCookie("calendar-readonly@example.com");

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
    expect(detailBody.participants.map((row) => row.role).sort()).toEqual([
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
      data: { sourceKey: string; sortKey: string; label: string | null }[];
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
    expect([...sortKeys].sort().toReversed()).toEqual(sortKeys);
    // No privileged content on a merged page: the titles stay behind the link.
    expect(JSON.stringify(body.data)).not.toContain("Estate conference");
    expect(JSON.stringify(body.data)).not.toContain("Inventory due");

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
