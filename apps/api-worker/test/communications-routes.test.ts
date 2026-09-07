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
