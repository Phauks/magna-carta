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

// The Custodian route surface, driven through the chokepoint over real Miniflare bindings: build a
// location tree, log a packet owned by a Directory entity with no matter, itemize it, check it out to
// a named borrower with a due-back date, see it appear in the overdue read, check it back in, and
// read a history that tells the whole story in order.
//
// Two facts about this surface are exercised deliberately: there is no check-out route (every state
// change is one movement post), and a retried movement produces exactly one ledger row.

let poolFirmId: FirmId;
let ownerCookie: string;
let noPermissionCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

// A member with no role and one unrelated direct grant — proves the chokepoint refuses custody:manage
// to a caller who genuinely lacks it, rather than to one who has no session at all.
async function mirrorMemberWithUnrelatedGrant(userId: UserId, displayName: string): Promise<void> {
  await insertMemberStatement(firmDatabase, { userId, displayName, now: clock.now() }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "firm:reportIncident", clock.now())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Custody Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser("custody-owner@example.com", {
    userName: "Custody Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Custody Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("custody-owner@example.com");

  const noPermission = await seedCredentialedUser("custody-nopermission@example.com", {
    userName: "No Permission",
    firmId: poolFirmId,
  });
  await mirrorMemberWithUnrelatedGrant(noPermission.userId, "No Permission");
  noPermissionCookie = await signInForSessionCookie("custody-nopermission@example.com");
});

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

async function postWithoutKey(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie),
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function createPerson(given: string, family: string): Promise<string> {
  const response = await post("/api/v1/directory/persons", { given, family });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

async function createLocation(
  name: string,
  kind: string,
  parentLocationId?: string,
): Promise<string> {
  const response = await post("/api/v1/custody/locations", {
    name,
    kind,
    ...(parentLocationId === undefined ? {} : { parentLocationId }),
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

describe("the custody register end to end", () => {
  it("logs, itemizes, checks out, surfaces as overdue, and checks back in", async () => {
    const office = await createLocation("Reno office", "office");
    const safe = await createLocation("Main safe", "safe", office);
    const ownerEntityId = await createPerson("Jane", "Custody-Smith");

    // No matter at all — the common steady state for a will held for a former client.
    const logged = await post("/api/v1/custody/packets", {
      name: "Smith family deeds",
      owners: [{ entityId: ownerEntityId, ownershipRole: "owner" }],
      currentLocationId: safe,
    });
    expect(logged.status).toBe(201);
    const packet = (await logged.json()) as {
      id: string;
      custodyNumber: string;
      filingMatterId: string;
    };
    expect(packet.id).toMatch(/^custodyPacket_/);
    expect(packet.custodyNumber).toMatch(/^CUS-\d{5}$/);
    // A matterless packet still has somewhere for its scans to be filed.
    expect(packet.filingMatterId).toMatch(/^matter_/);

    const itemized = await post(`/api/v1/custody/packets/${packet.id}/items`, {
      description: "Original will of Jane Smith dated 14 March 2019",
      instrumentDate: "2019-03-14",
      intrinsicValue: true,
    });
    expect(itemized.status).toBe(201);

    // There is no check-out route: it is one movement post with a kind.
    const checkedOut = await post(`/api/v1/custody/packets/${packet.id}/movements`, {
      kind: "checked_out",
      borrower: { kind: "external", name: "M. Alvarez (courier)" },
      // A due-back date already in the past, so the overdue read below has something to find without
      // back-dating the event itself out of the history's order.
      dueBackOn: "2020-01-01",
    });
    expect(checkedOut.status).toBe(201);
    expect(await checkedOut.json()).toMatchObject({ packetStatus: "out" });

    const overdue = await get("/api/v1/custody/overdue?asOf=2026-08-04");
    expect(overdue.status).toBe(200);
    const overdueBody = (await overdue.json()) as { data: Array<{ packetId: string }> };
    expect(overdueBody.data.some((row) => row.packetId === packet.id)).toBe(true);

    const returned = await post(`/api/v1/custody/packets/${packet.id}/movements`, {
      kind: "returned",
      toLocationId: safe,
    });
    expect(returned.status).toBe(201);
    expect(await returned.json()).toMatchObject({ packetStatus: "held" });

    // Once returned it is no longer overdue, however overdue its check-out row once was.
    const overdueAfter = await get("/api/v1/custody/overdue?asOf=2026-08-04");
    const overdueAfterBody = (await overdueAfter.json()) as { data: Array<{ packetId: string }> };
    expect(overdueAfterBody.data.some((row) => row.packetId === packet.id)).toBe(false);

    const detail = await get(`/api/v1/custody/packets/${packet.id}`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      status: string;
      locationPath: Array<{ name: string }>;
      items: Array<{ description: string; intrinsicValue: boolean }>;
      owners: Array<{ entityId: string }>;
    };
    expect(detailBody.status).toBe("held");
    expect(detailBody.locationPath.map((node) => node.name)).toEqual(["Reno office", "Main safe"]);
    expect(detailBody.items[0]?.intrinsicValue).toBe(true);
    expect(detailBody.owners[0]?.entityId).toBe(ownerEntityId);

    const history = await get(`/api/v1/custody/packets/${packet.id}/movements`);
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as { data: Array<{ kind: string }> };
    // Newest first, ordered by when each event happened.
    expect(historyBody.data.map((movement) => movement.kind)).toEqual([
      "returned",
      "checked_out",
      "itemized",
      "logged",
    ]);
  });

  it("refuses a packet logged with no Directory owner (422)", async () => {
    const safe = await createLocation("No-owner safe", "safe");
    const response = await post("/api/v1/custody/packets", {
      name: "Unattributable envelope",
      owners: [],
      currentLocationId: safe,
    });
    expect(response.status).toBe(422);
  });

  it("refuses closing a location that still holds a packet (409)", async () => {
    const safe = await createLocation("Occupied safe", "safe");
    const ownerEntityId = await createPerson("Occupied", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Still in the safe",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    expect(logged.status).toBe(201);
    const closed = await patch(`/api/v1/custody/locations/${safe}`, { close: true });
    expect(closed.status).toBe(409);
  });

  it("blocks a release under a hold and allows it once the hold is released", async () => {
    const safe = await createLocation("Hold safe", "safe");
    const ownerEntityId = await createPerson("Held", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Held originals",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };

    const placed = await post(`/api/v1/custody/packets/${packetId}/holds`, {
      kind: "legal",
      reason: "estate dispute",
    });
    expect(placed.status).toBe(201);
    const { id: holdId } = (await placed.json()) as { id: string };

    const blocked = await post(`/api/v1/custody/packets/${packetId}/movements`, {
      kind: "released",
    });
    expect(blocked.status).toBe(409);

    // A hold forbids the property leaving, not being moved somewhere safer.
    const vault = await createLocation("Fireproof vault", "safe");
    const moved = await post(`/api/v1/custody/packets/${packetId}/movements`, {
      kind: "moved",
      toLocationId: vault,
    });
    expect(moved.status).toBe(201);

    const released = await post(`/api/v1/custody/holds/${holdId}/release`, {});
    expect(released.status).toBe(200);
    const nowReleasable = await post(`/api/v1/custody/packets/${packetId}/movements`, {
      kind: "released",
    });
    expect(nowReleasable.status).toBe(201);
  });

  it("produces exactly one ledger row for a retried movement", async () => {
    const safe = await createLocation("Retry safe", "safe");
    const vault = await createLocation("Retry vault", "safe");
    const ownerEntityId = await createPerson("Retry", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Retried movement packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };

    const key = crypto.randomUUID();
    const body = { kind: "moved", toLocationId: vault };
    const first = await post(
      `/api/v1/custody/packets/${packetId}/movements`,
      body,
      ownerCookie,
      key,
    );
    expect(first.status).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };
    const retry = await post(
      `/api/v1/custody/packets/${packetId}/movements`,
      body,
      ownerCookie,
      key,
    );
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as { id: string }).id).toBe(firstId);

    const history = await get(`/api/v1/custody/packets/${packetId}/movements`);
    const historyBody = (await history.json()) as { data: Array<{ kind: string }> };
    expect(historyBody.data.filter((movement) => movement.kind === "moved")).toHaveLength(1);
  });
});

describe("the custody chokepoint contract", () => {
  it("refuses an unauthenticated read (401)", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/custody/locations", {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a caller lacking custody:manage (403)", async () => {
    const response = await post(
      "/api/v1/custody/locations",
      { name: "Unauthorized safe", kind: "safe" },
      noPermissionCookie,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a movement with no Idempotency-Key (400)", async () => {
    const safe = await createLocation("Key-required safe", "safe");
    const ownerEntityId = await createPerson("KeyRequired", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Key-required packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };
    const response = await postWithoutKey(`/api/v1/custody/packets/${packetId}/movements`, {
      kind: "moved",
      toLocationId: safe,
    });
    expect(response.status).toBe(400);
  });

  it("lists the seeded item-type catalog", async () => {
    const response = await get("/api/v1/custody/item-types");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ name: string; intrinsicValueDefault: boolean }>;
    };
    const will = body.data.find((type) => type.name === "Original will");
    expect(will?.intrinsicValueDefault).toBe(true);
  });
});

describe("review dates, reminders, reports, and labels", () => {
  it("schedules a review, completes it, and rolls the date forward on its anniversary", async () => {
    const safe = await createLocation("Review safe", "safe");
    const ownerEntityId = await createPerson("Review", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Review packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };

    const scheduled = await patch(`/api/v1/custody/packets/${packetId}`, {
      reviewOn: "2026-05-01",
      reviewIntervalMonths: 60,
    });
    expect(scheduled.status).toBe(200);

    const reminders = await get("/api/v1/custody/reminders?asOf=2026-08-04");
    expect(reminders.status).toBe(200);
    const reminderBody = (await reminders.json()) as {
      data: Array<{ packetId: string; reason: string; bucket: string }>;
    };
    expect(
      reminderBody.data.some((row) => row.packetId === packetId && row.reason === "review-due"),
    ).toBe(true);

    const completed = await post(`/api/v1/custody/packets/${packetId}/reviews`, {
      occurredAt: "2026-08-04T09:00:00.000Z",
    });
    expect(completed.status).toBe(201);
    // Anchored on the schedule, not on today: a review done late does not drag the cycle with it.
    expect(await completed.json()).toMatchObject({ nextReviewOn: "2031-05-01" });

    const detail = await get(`/api/v1/custody/packets/${packetId}`);
    const detailBody = (await detail.json()) as { reviewOn: string | null };
    expect(detailBody.reviewOn).toBe("2031-05-01");

    // A completed review is a ledger entry, because the ledger is the only record this subsystem
    // keeps that anything happened.
    const history = await get(`/api/v1/custody/packets/${packetId}/movements`);
    const historyBody = (await history.json()) as { data: Array<{ kind: string }> };
    expect(historyBody.data.map((movement) => movement.kind)).toContain("reviewed");

    // And it is no longer on the reminder list.
    const after = await get("/api/v1/custody/reminders?asOf=2026-08-04");
    const afterBody = (await after.json()) as { data: Array<{ packetId: string }> };
    expect(afterBody.data.some((row) => row.packetId === packetId)).toBe(false);
  });

  it("records a retried review exactly once", async () => {
    const safe = await createLocation("Retry review safe", "safe");
    const ownerEntityId = await createPerson("RetryReview", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Retry review packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };
    await patch(`/api/v1/custody/packets/${packetId}`, { reviewOn: "2026-05-01" });

    const key = crypto.randomUUID();
    const body = { occurredAt: "2026-08-04T09:00:00.000Z" };
    const first = await post(`/api/v1/custody/packets/${packetId}/reviews`, body, ownerCookie, key);
    const replay = await post(
      `/api/v1/custody/packets/${packetId}/reviews`,
      body,
      ownerCookie,
      key,
    );
    expect(first.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());

    const history = await get(`/api/v1/custody/packets/${packetId}/movements`);
    const historyBody = (await history.json()) as { data: Array<{ kind: string }> };
    expect(historyBody.data.filter((movement) => movement.kind === "reviewed")).toHaveLength(1);
  });

  it("reports holdings by owner and by location, and lists holds in force", async () => {
    const office = await createLocation("Report office", "office");
    const safe = await createLocation("Report safe", "safe", office);
    const ownerEntityId = await createPerson("Report", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Report packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };
    const held = await post(`/api/v1/custody/packets/${packetId}/holds`, {
      kind: "legal",
      reason: "Estate dispute",
    });
    expect(held.status).toBe(201);

    const byOwner = await get("/api/v1/custody/reports/holdings-by-owner?limit=500");
    expect(byOwner.status).toBe(200);
    const byOwnerBody = (await byOwner.json()) as {
      data: Array<{ entityId: string; packetsHeld: number; packetsUnderHold: number }>;
    };
    expect(byOwnerBody.data.find((entry) => entry.entityId === ownerEntityId)).toMatchObject({
      packetsHeld: 1,
      packetsUnderHold: 1,
    });

    const byLocation = await get("/api/v1/custody/reports/holdings-by-location");
    expect(byLocation.status).toBe(200);
    const byLocationBody = (await byLocation.json()) as {
      data: Array<{ locationId: string; directOccupancy: number; subtreeOccupancy: number }>;
    };
    expect(
      byLocationBody.data.find((entry) => entry.locationId === office)?.subtreeOccupancy,
    ).toBeGreaterThanOrEqual(1);
    expect(byLocationBody.data.find((entry) => entry.locationId === safe)?.directOccupancy).toBe(1);

    const holds = await get("/api/v1/custody/reports/holds");
    expect(holds.status).toBe(200);
    const holdsBody = (await holds.json()) as { data: Array<{ packetId: string; kind: string }> };
    expect(holdsBody.data.some((entry) => entry.packetId === packetId)).toBe(true);
  });

  it("renders a printable label sheet as SVG, and refuses one that would not fit", async () => {
    const safe = await createLocation("Label safe", "safe");
    const ownerEntityId = await createPerson("Label", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Label packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const packet = (await logged.json()) as { id: string; custodyNumber: string };

    const sheet = await get(
      `/api/v1/custody/labels?packetIds=${packet.id}&locationIds=${safe}&startPosition=2`,
    );
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await sheet.text();
    expect(svg.startsWith("<svg")).toBe(true);
    // The barcode carries the handle a scanner resolves; the custody number is what a person reads.
    expect(svg).toContain(packet.id);
    expect(svg).toContain(packet.custodyNumber);

    // One sheet per request: a label that fell onto a second page is a label on the wrong box.
    const overfull = await get(
      `/api/v1/custody/labels?packetIds=${Array.from({ length: 25 }, () => packet.id).join(",")}`,
    );
    expect(overfull.status).toBe(422);
  });

  it("refuses the reports and the label sheet to a caller lacking custody:read (403)", async () => {
    for (const path of [
      "/api/v1/custody/reminders",
      "/api/v1/custody/reports/holdings-by-owner",
      "/api/v1/custody/reports/holdings-by-location",
      "/api/v1/custody/reports/holds",
      "/api/v1/custody/labels?packetIds=custodyPacket_unreachable",
    ]) {
      const response = await get(path, noPermissionCookie);
      expect(response.status, path).toBe(403);
    }
  });
});
