import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The call and text log's HTTP surface, exercised for the two things that would be real product
// failures if they stopped holding: WHO may see the queue of unfiled rows, and WHAT counts as an
// anchor a row may be filed onto.
//
// The queue is the reason this surface has a third capability at all. Every filed row is narrowed
// server-side to matters the member may see, so a walled matter contributes nothing to the firm-wide
// read; an UNFILED row has no matter, so that narrowing has nothing to bite on. What sits in the
// queue is whatever was said to the firm's number before anybody decided where it belonged.
//
// The seeded Attorney role is the instrument: the migration grants it communications:read and
// communications:log, and deliberately NOT communications:reviewUnrouted. So an Attorney is a member
// who may read and record the firm's calls and may not open the post.

let firmId: FirmId;
let ownerCookie: string;
let attorneyCookie: string;
let attorneyUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const OPEN_MATTER = "matter_commsRouteOpen0000000" as MatterId;
const INTAKE_MATTER = "matter_commsRouteIntake00000" as MatterId;
const CLOSED_MATTER = "matter_commsRouteClosed00000" as MatterId;

const clock = { now: () => new Date().toISOString() };

/**
 * An instant safely in the past, computed rather than written down.
 *
 * A literal date would pass or fail depending on the hour the suite runs: the log refuses an instant
 * in the future, so a fixed time on today's date is a call that has not happened yet until the
 * afternoon. Relative to now, it is a call an hour ago on every run.
 */
function anHourAgo(): string {
  return new Date(Date.now() - 3_600_000).toISOString();
}

interface LoggedResponse {
  id: string;
}
interface PageResponse {
  data: { id: string; matterId: string | null; matterStatus: string | null }[];
  nextCursor: string | null;
}

async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, { headers: { cookie } });
}

async function remove(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method: "DELETE",
    headers: { cookie, "idempotency-key": crypto.randomUUID() },
  });
}

async function patch(path: string, cookie: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

/** Log a call and hand back its id, failing loudly rather than returning an undefined handle. */
async function logCall(cookie: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await post("/api/v1/communications", cookie, {
    channel: "voice",
    direction: "inbound",
    counterpartyNumber: "(702) 555-0143",
    occurredAt: anHourAgo(),
    durationSeconds: 300,
    summary: "Asked whether we act in probate.",
    ...body,
  });
  expect(response.status).toBe(201);
  return (await readJson<LoggedResponse>(response)).id;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Call Log Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("call-log-owner@example.com", {
    userName: "Call Log Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Call Log Owner", firmId);
  ownerCookie = await signInForSessionCookie("call-log-owner@example.com");

  const attorney = await seedCredentialedUser("call-log-attorney@example.com", {
    userName: "Call Log Attorney",
    firmId,
  });
  const attorneyRole = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = 'Attorney'")
    .all<{ id: string }>();
  const attorneyRoleId = attorneyRole.results[0]?.id;
  if (attorneyRoleId === undefined) throw new Error("seeded Attorney role missing");
  await insertMemberStatement(firmDatabase, {
    userId: attorney.userId as UserId,
    displayName: "Call Log Attorney",
    now: clock.now(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: attorney.userId as UserId,
    roleId: assertIdentifier(attorneyRoleId, "role"),
  }).run();
  attorneyCookie = await signInForSessionCookie("call-log-attorney@example.com");
  attorneyUserId = attorney.userId as UserId;

  // Three anchors, one per answer the routing rule has to give: an ordinary open matter, an INTAKE
  // (no number of any kind, and the anchor a first phone call actually lands on), and a closed one.
  const columns = "id, title, status, responsible_member_id, matter_number, created_at, updated_at";
  const rows: readonly [MatterId, string, string, string][] = [
    [OPEN_MATTER, "Herrera v Alvarez", "open", "'2026-0041'"],
    [INTAKE_MATTER, "Enquiry from R. Pell", "intake", "NULL"],
    [CLOSED_MATTER, "Brown estate", "closed", "'2026-0012'"],
  ];
  for (const [id, title, status, number] of rows) {
    await firmDatabase
      .prepare(`INSERT INTO matter (${columns}) VALUES (?1, ?2, ?3, ?4, ${number}, ?5, ?5)`)
      .bind(id, title, status, owner.userId, clock.now())
      .run();
  }
});

beforeEach(async () => {
  await firmDatabase.prepare("DELETE FROM communication").run();
  // The day's counter goes with the rows. It is the sequence's own state, and leaving it behind
  // would make every number in this file depend on how many tests ran before it.
  await firmDatabase.prepare("DELETE FROM communication_number_counter").run();
});

describe("who may see the queue of unfiled calls and texts", () => {
  it("refuses the queue outright to a member without the review capability", async () => {
    await logCall(ownerCookie);

    const refused = await get("/api/v1/communications?scope=unrouted", attorneyCookie);
    // The identical refusal the chokepoint's own primary gate returns, so a caller cannot tell
    // which gate stopped them.
    expect(refused.status).toBe(403);

    const allowed = await get("/api/v1/communications?scope=unrouted", ownerCookie);
    expect(allowed.status).toBe(200);
    expect((await readJson<PageResponse>(allowed)).data).toHaveLength(1);
  });

  it("omits unfiled rows from the ordinary listing rather than refusing it", async () => {
    await logCall(ownerCookie, { matterId: OPEN_MATTER });
    await logCall(ownerCookie);

    // Browsing without the capability is not a refusal — the rows simply are not there. Asking for
    // the queue by name is, which is the difference between "you may not look at this" and "there
    // is nothing here for you".
    const attorneyPage = await get("/api/v1/communications", attorneyCookie);
    expect(attorneyPage.status).toBe(200);
    const attorneyRows = (await readJson<PageResponse>(attorneyPage)).data;
    expect(attorneyRows).toHaveLength(1);
    expect(attorneyRows[0]?.matterId).toBe(OPEN_MATTER);

    const ownerPage = await get("/api/v1/communications", ownerCookie);
    expect((await readJson<PageResponse>(ownerPage)).data).toHaveLength(2);
  });

  it("refuses to reach an unfiled row by id without the capability", async () => {
    const id = await logCall(ownerCookie);

    // The list and the id-addressed read agree, which is what stops the queue being enumerated one
    // handle at a time by a member the list refuses.
    expect((await get(`/api/v1/communications/${id}`, attorneyCookie)).status).toBe(404);
    expect((await get(`/api/v1/communications/${id}`, ownerCookie)).status).toBe(200);
  });

  it("refuses to FILE an unfiled row without the capability", async () => {
    const id = await logCall(ownerCookie);

    // Filing necessarily reads the row on its way, so it takes the same key as seeing it —
    // otherwise the queue could be worked by id from outside the permission that reveals it.
    const refused = await post(`/api/v1/communications/${id}/matter`, attorneyCookie, {
      matterId: OPEN_MATTER,
    });
    expect(refused.status).toBe(403);
  });

  it("counts the queue only for a member who may work it", async () => {
    await logCall(ownerCookie);
    await logCall(ownerCookie);

    expect((await get("/api/v1/communications/unrouted-count", attorneyCookie)).status).toBe(403);
    const counted = await get("/api/v1/communications/unrouted-count", ownerCookie);
    expect(await readJson<{ count: number }>(counted)).toEqual({ count: 2 });
  });
});

describe("what counts as an anchor", () => {
  // THE OWNER'S RULING OF 2026-09-07: a text may be on an intake or a consultation, it does not need
  // a number, but it needs a status. An intake carries no number of any kind, and it is where a
  // first phone call from a stranger actually lands.
  it("files a call onto an intake, which has no number at all", async () => {
    const id = await logCall(ownerCookie);

    const filed = await post(`/api/v1/communications/${id}/matter`, ownerCookie, {
      matterId: INTAKE_MATTER,
    });
    expect(filed.status).toBe(200);

    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    const row = await readJson<{
      matterId: string;
      matterNumber: string | null;
      matterStatus: string;
    }>(read);
    expect(row.matterId).toBe(INTAKE_MATTER);
    expect(row.matterNumber).toBeNull();
    // The status rides on the row because what may be said to a prospect and to a client differ.
    expect(row.matterStatus).toBe("intake");
  });

  it("logs straight onto an intake without going through the queue first", async () => {
    const id = await logCall(ownerCookie, { matterId: INTAKE_MATTER });

    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    expect((await readJson<{ matterId: string }>(read)).matterId).toBe(INTAKE_MATTER);
  });

  it("refuses a closed matter", async () => {
    const id = await logCall(ownerCookie);

    const refused = await post(`/api/v1/communications/${id}/matter`, ownerCookie, {
      matterId: CLOSED_MATTER,
    });
    // 422 rather than 404: the matter is real and visible, and the fix is to reopen it.
    expect(refused.status).toBe(422);
  });

  it("refuses a matter that does not exist the way it refuses one it may not see", async () => {
    const id = await logCall(ownerCookie);

    const refused = await post(`/api/v1/communications/${id}/matter`, ownerCookie, {
      matterId: "matter_neverExisted000000000",
    });
    expect(refused.status).toBe(404);
  });
});

describe("the matter's own section", () => {
  it("reads the same rows narrowed to one matter, and never the queue", async () => {
    await logCall(ownerCookie, { matterId: OPEN_MATTER });
    await logCall(ownerCookie, { matterId: INTAKE_MATTER });
    await logCall(ownerCookie);

    const page = await get(`/api/v1/matters/${OPEN_MATTER}/communications`, ownerCookie);
    expect(page.status).toBe(200);
    const rows = (await readJson<PageResponse>(page)).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.matterId).toBe(OPEN_MATTER);
  });

  it("lets a member without the queue capability read a matter's own log", async () => {
    await logCall(ownerCookie, { matterId: OPEN_MATTER });

    // The queue capability gates the unfiled rows, never a matter's own record — an Attorney who
    // may not open the post may certainly read what was said on their own case.
    const page = await get(`/api/v1/matters/${OPEN_MATTER}/communications`, attorneyCookie);
    expect(page.status).toBe(200);
    expect((await readJson<PageResponse>(page)).data).toHaveLength(1);
  });
});

describe("taking a row back off a matter", () => {
  it("returns it to the queue rather than deleting it", async () => {
    const id = await logCall(ownerCookie, { matterId: OPEN_MATTER });

    const taken = await SELF.fetch(`https://example.test/api/v1/communications/${id}/matter`, {
      method: "DELETE",
      headers: { cookie: ownerCookie, "idempotency-key": crypto.randomUUID() },
    });
    expect(taken.status).toBe(200);

    // What was said still happened. The row is back in the queue with its words intact, which is
    // what makes taking one off the wrong matter safe.
    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    const row = await readJson<{ matterId: string | null; summary: string }>(read);
    expect(row.matterId).toBeNull();
    expect(row.summary).toBe("Asked whether we act in probate.");
  });
});

describe("a call that belongs to no matter at all", () => {
  // Not every call a firm takes is about a case. Spam, the landlord, an enquiry that never came to
  // anything: none of them can be filed, and before they could be SET ASIDE they sat in the queue
  // forever. A queue nobody can empty is a queue nobody works.
  it("leaves the queue without being filed, and comes back", async () => {
    const id = await logCall(ownerCookie);

    const aside = await post(`/api/v1/communications/${id}/disposition`, ownerCookie, {
      disposition: "spam",
    });
    expect(aside.status).toBe(200);

    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    const row = await readJson<{ disposition: string | null; summary: string }>(read);
    expect(row.disposition).toBe("spam");
    // Nothing was destroyed by the decision.
    expect(row.summary).toBe("Asked whether we act in probate.");

    const queue = await get("/api/v1/communications?scope=unrouted", ownerCookie);
    expect((await readJson<PageResponse>(queue)).data).toHaveLength(0);
    const setAside = await get("/api/v1/communications?scope=setAside", ownerCookie);
    expect((await readJson<PageResponse>(setAside)).data).toHaveLength(1);

    const back = await remove(`/api/v1/communications/${id}/disposition`, ownerCookie);
    expect(back.status).toBe(200);
    const requeued = await get("/api/v1/communications?scope=unrouted", ownerCookie);
    expect((await readJson<PageResponse>(requeued)).data).toHaveLength(1);
  });

  it("is refused to a member who may not work the queue", async () => {
    const id = await logCall(ownerCookie);
    // Setting a row aside READS an unrouted row on its way, exactly as filing one does, so it is
    // gated by the same key that reveals the queue at all.
    const refused = await post(`/api/v1/communications/${id}/disposition`, attorneyCookie, {
      disposition: "spam",
    });
    expect(refused.status).toBe(403);
    // And so is asking for the set-aside rows in the first place.
    const listing = await get("/api/v1/communications?scope=setAside", attorneyCookie);
    expect(listing.status).toBe(403);
  });

  it("refuses a reason that is not in the vocabulary", async () => {
    const id = await logCall(ownerCookie);
    const refused = await post(`/api/v1/communications/${id}/disposition`, ownerCookie, {
      disposition: "because",
    });
    expect(refused.status).toBe(422);
  });

  it("refuses a record claiming both a matter and a reason", async () => {
    const refused = await post("/api/v1/communications", ownerCookie, {
      channel: "voice",
      direction: "inbound",
      counterpartyNumber: "(702) 555-0143",
      occurredAt: anHourAgo(),
      durationSeconds: 60,
      summary: "Both at once.",
      matterId: OPEN_MATTER,
      disposition: "spam",
    });
    expect(refused.status).toBe(422);
  });
});

describe("correcting a record somebody typed", () => {
  it("changes what it names and leaves the anchor alone", async () => {
    const id = await logCall(ownerCookie, { matterId: OPEN_MATTER });

    const corrected = await patch(`/api/v1/communications/${id}`, ownerCookie, {
      counterpartyNumber: "+17025559999",
      summary: "Asked whether we act in probate. Calling back Thursday.",
    });
    expect(corrected.status).toBe(200);

    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    const row = await readJson<{
      counterpartyNumber: string;
      summary: string;
      matterId: string | null;
      durationSeconds: number | null;
    }>(read);
    expect(row.counterpartyNumber).toBe("+17025559999");
    expect(row.summary).toBe("Asked whether we act in probate. Calling back Thursday.");
    // Untouched fields keep what the record holds, and the matter is not this operation's to move.
    expect(row.durationSeconds).toBe(300);
    expect(row.matterId).toBe(OPEN_MATTER);
  });

  it("cannot reach an unfiled row without the queue capability", async () => {
    const id = await logCall(ownerCookie);
    const refused = await patch(`/api/v1/communications/${id}`, attorneyCookie, {
      direction: "outbound",
    });
    // Not found rather than forbidden: an id-addressed write must not become a way to learn that a
    // row a member cannot list exists.
    expect(refused.status).toBe(404);
  });
});

describe("the number a call carries, and the one it is about to be given", () => {
  /*
   * The owner's ruling of 2026-09-08: "all calls and logs should have a number, which we can identify
   * in the log, before it has been created. should incorporate date." The preview is what makes the
   * second half true — the person entering the call is still on the telephone, and the save is too
   * late for the sentence they are in the middle of.
   */
  it("answers the number the next call recorded for that day would draw", async () => {
    const response = await get(
      "/api/v1/communications/next-number?occurredAt=2026-09-07T10:15:00.000Z",
      ownerCookie,
    );
    expect(response.status).toBe(200);
    expect((await readJson<{ referenceNumber: string }>(response)).referenceNumber).toBe(
      "2026-09-07-0001",
    );
  });

  it("hands that same number to the record when it is saved", async () => {
    const previewed = (
      await readJson<{ referenceNumber: string }>(
        await get(
          "/api/v1/communications/next-number?occurredAt=2026-09-07T10:15:00.000Z",
          ownerCookie,
        ),
      )
    ).referenceNumber;
    const id = await logCall(ownerCookie, { occurredAt: "2026-09-07T10:15:00.000Z" });
    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    expect((await readJson<{ referenceNumber: string }>(read)).referenceNumber).toBe(previewed);
  });

  it("moves on once that number is taken, rather than promising it twice", async () => {
    await logCall(ownerCookie, { occurredAt: "2026-09-07T10:15:00.000Z" });
    const response = await get(
      "/api/v1/communications/next-number?occurredAt=2026-09-07T10:15:00.000Z",
      ownerCookie,
    );
    expect((await readJson<{ referenceNumber: string }>(response)).referenceNumber).toBe(
      "2026-09-07-0002",
    );
  });

  it("is matched by the log's own search, because it is what a caller quotes back", async () => {
    await logCall(ownerCookie, { occurredAt: "2026-09-07T10:15:00.000Z" });
    const found = await get("/api/v1/communications?search=2026-09-07-0001", ownerCookie);
    expect((await readJson<{ data: unknown[] }>(found)).data).toHaveLength(1);
  });
});

describe("the end of a call, which is not its length", () => {
  it("stores both, and does not require them to agree", async () => {
    // An hour on the line, twenty minutes of call. Both are true — the rest was hold.
    const id = await logCall(ownerCookie, {
      occurredAt: "2026-09-07T10:00:00.000Z",
      endedAt: "2026-09-07T11:00:00.000Z",
      durationSeconds: 20 * 60,
    });
    const read = await readJson<{ endedAt: string | null; durationSeconds: number | null }>(
      await get(`/api/v1/communications/${id}`, ownerCookie),
    );
    expect(read.endedAt).toBe("2026-09-07T11:00:00.000Z");
    expect(read.durationSeconds).toBe(20 * 60);
  });

  it("refuses an end that precedes the start", async () => {
    const refused = await post("/api/v1/communications", ownerCookie, {
      channel: "voice",
      direction: "inbound",
      counterpartyNumber: "(702) 555-0143",
      occurredAt: "2026-09-07T10:00:00.000Z",
      endedAt: "2026-09-07T09:00:00.000Z",
      summary: "A call that cannot have happened this way.",
    });
    expect(refused.status).toBe(422);
  });
});

describe("what happened on the line, and what came of it", () => {
  it("leaves a message as a task in the colleague's list, saved with the call", async () => {
    const id = await logCall(ownerCookie, {
      summary: "Wants to know whether the hearing moved.",
      callerIdName: "Maria Lopez",
      outcome: "messageTaken",
      message: {
        forUserId: attorneyUserId,
        title: "Call back Maria Lopez",
        dueOn: "2026-12-01",
        timeZone: "America/Los_Angeles",
        urgent: true,
      },
    });
    const read = await get(`/api/v1/communications/${id}`, ownerCookie);
    const record = await readJson<{
      outcome: string;
      callerIdName: string;
      messageTaskId: string | null;
    }>(read);
    expect(record.outcome).toBe("messageTaken");
    expect(record.callerIdName).toBe("Maria Lopez");
    expect(record.messageTaskId).not.toBeNull();
    const task = await firmDatabase
      .prepare("SELECT title, assignee_user_id, priority, due_on FROM matter_task WHERE id = ?1")
      .bind(record.messageTaskId)
      .first<{ title: string; assignee_user_id: string; priority: string; due_on: string }>();
    expect(task).toMatchObject({
      title: "Call back Maria Lopez",
      assignee_user_id: attorneyUserId,
      priority: "urgent",
      due_on: "2026-12-01",
    });
  });

  it("files a spam call as spam on its own", async () => {
    const id = await logCall(ownerCookie, {
      summary: null,
      durationSeconds: null,
      outcome: "spam",
      spamKind: "sales",
    });
    const record = await readJson<{ disposition: string; spamKind: string }>(
      await get(`/api/v1/communications/${id}`, ownerCookie),
    );
    expect(record).toMatchObject({ disposition: "spam", spamKind: "sales" });
  });
});
