import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
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
let ownerUserId: UserId;
let noPermissionCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

// The stocktake surface gets its OWN firm, and that is a rate-limit fact rather than an isolation
// one: the chokepoint's rate-limit key is `firm:<firmId>`, so every request this file makes shares
// one bucket. A full count is request-heavy by nature — a tree, several packets, a batch of
// observations, a reconciliation, a close, and the re-reads that prove nothing moved — and stacking
// it onto the register suite's budget would spend the window on scaffolding and start returning 429
// to whichever test happened to run last. A second firm is one more seed and buys the block its own
// bucket, so neither suite has to be kept artificially small to fit beside the other.
let stocktakeOwnerCookie: string;
let stocktakeNoPermissionCookie: string;

const clock = { now: () => new Date().toISOString() };

// A member with no role and one unrelated direct grant — proves the chokepoint refuses custody:manage
// to a caller who genuinely lacks it, rather than to one who has no session at all.
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
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("custody-owner@example.com");

  const noPermission = await seedCredentialedUser("custody-nopermission@example.com", {
    userName: "No Permission",
    firmId: poolFirmId,
  });
  await mirrorMemberWithUnrelatedGrant(firmDatabase, noPermission.userId, "No Permission");
  noPermissionCookie = await signInForSessionCookie("custody-nopermission@example.com");

  const stocktakeFirmId = (await seedFirm({ name: "Custody Stocktake Test Firm" })).firmId;
  const stocktakeDatabase = firmDatabaseFor(env.FIRM_DATABASE, stocktakeFirmId);
  const stocktakeOwner = await seedCredentialedUser("custody-stocktake-owner@example.com", {
    userName: "Stocktake Owner",
    firmId: stocktakeFirmId,
  });
  await mirrorMemberWithOwnerRole(stocktakeOwner.userId, "Stocktake Owner", stocktakeFirmId);
  stocktakeOwnerCookie = await signInForSessionCookie("custody-stocktake-owner@example.com");

  const stocktakeNoPermission = await seedCredentialedUser(
    "custody-stocktake-nopermission@example.com",
    { userName: "Stocktake No Permission", firmId: stocktakeFirmId },
  );
  await mirrorMemberWithUnrelatedGrant(
    stocktakeDatabase,
    stocktakeNoPermission.userId,
    "Stocktake No Permission",
  );
  stocktakeNoPermissionCookie = await signInForSessionCookie(
    "custody-stocktake-nopermission@example.com",
  );
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

// A release that satisfies the gate. Every test whose subject is something else — a hold, a chokepoint
// contract — posts this, so the gate is never accidentally the thing being asserted.
//
// The member who checked identity is NOT in the body: it is the authenticated caller, which is the
// whole of the binding that stops a two-signatory release from being composed by one person.
function authorizedRelease() {
  return {
    kind: "released",
    borrower: { kind: "external", name: "A. Collector" },
    releaseAuthorization: {
      authorityBasis: "owner collecting their own original in person",
      identityEvidence: "photographic identification checked against the Directory record",
    },
  };
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

  /*
   * AN ITEM'S CHAIN OF CUSTODY IS ITS OWN ENTRIES PLUS THE PACKET'S.
   *
   * This is the case a naive `item_id = ?` filter gets wrong, and it gets it wrong silently: an
   * original will that has moved safes twice and been out to a completion meeting would answer with
   * "Contents described" and nothing else, which reads as a chain of custody and is not one. An item
   * inside a packet goes wherever the packet goes, so those entries belong to it too, and the row's
   * own `itemId` is what lets a reader tell which of the two each entry is.
   */
  it("answers one item's history as its own entries plus the packet-wide ones", async () => {
    const safe = await createLocation("Item-history safe", "safe");
    const other = await createLocation("Item-history annexe", "safe");
    const ownerEntityId = await createPerson("Ada", "Item-History");

    const logged = await post("/api/v1/custody/packets", {
      name: "Two-instrument packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const packet = (await logged.json()) as { id: string };

    const firstItem = await post(`/api/v1/custody/packets/${packet.id}/items`, {
      description: "Original will",
    });
    expect(firstItem.status).toBe(201);
    const willId = ((await firstItem.json()) as { id: string }).id;

    const secondItem = await post(`/api/v1/custody/packets/${packet.id}/items`, {
      description: "Share certificate",
    });
    expect(secondItem.status).toBe(201);

    // A packet-wide movement: both items went with it.
    const moved = await post(`/api/v1/custody/packets/${packet.id}/movements`, {
      kind: "moved",
      toLocationId: other,
    });
    expect(moved.status).toBe(201);

    const whole = await get(`/api/v1/custody/packets/${packet.id}/movements`);
    const wholeBody = (await whole.json()) as { data: Array<{ kind: string }> };
    expect(wholeBody.data.map((movement) => movement.kind)).toEqual([
      "moved",
      "itemized",
      "itemized",
      "logged",
    ]);

    const forItem = await get(
      `/api/v1/custody/packets/${packet.id}/movements?itemId=${encodeURIComponent(willId)}`,
    );
    expect(forItem.status).toBe(200);
    const itemBody = (await forItem.json()) as {
      data: Array<{ kind: string; itemId: string | null }>;
    };
    // The move and the logging are the packet's and are the will's history too; the OTHER item's
    // itemized row is not, and is the row a filter that merely dropped nothing would have left in.
    expect(itemBody.data.map((movement) => movement.kind)).toEqual(["moved", "itemized", "logged"]);
    expect(itemBody.data.map((movement) => movement.itemId)).toEqual([null, willId, null]);
  });

  /*
   * THE TENTATIVE NUMBER IS THE ONE THE NEXT DRAW TAKES, AND ASKING TAKES NOTHING.
   *
   * Both halves are worth pinning. If the preview disagreed with the draw it would be worse than
   * showing nothing — a person writes this on a physical label. And if asking ALLOCATED, a form
   * somebody opened and closed would burn a number, leaving gaps in a register whose whole value is
   * that it is a contemporaneous sequence.
   */
  it("previews the number the next packet draws, and allocates nothing by being asked", async () => {
    const safe = await createLocation("Preview safe", "safe");
    const ownerEntityId = await createPerson("Ida", "Preview");

    const before = await get("/api/v1/custody/next-number");
    expect(before.status).toBe(200);
    const previewed = (await before.json()) as { custodyNumber: string; tentative: boolean };
    expect(previewed.tentative).toBe(true);
    expect(previewed.custodyNumber).toMatch(/^CUS-\d{5}$/);

    // Asked twice with nothing logged in between, the answer does not move.
    const again = (await (await get("/api/v1/custody/next-number")).json()) as {
      custodyNumber: string;
    };
    expect(again.custodyNumber).toBe(previewed.custodyNumber);

    const logged = await post("/api/v1/custody/packets", {
      name: "Previewed packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    expect(logged.status).toBe(201);
    // The packet took exactly what the preview promised.
    expect((await logged.json()) as { custodyNumber: string }).toMatchObject({
      custodyNumber: previewed.custodyNumber,
    });

    // And the preview has moved on by one draw, not by two.
    const after = (await (await get("/api/v1/custody/next-number")).json()) as {
      custodyNumber: string;
    };
    expect(after.custodyNumber).not.toBe(previewed.custodyNumber);
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

    // Authorized in full, so the 409 is the hold refusing it and not the release gate.
    const blocked = await post(
      `/api/v1/custody/packets/${packetId}/movements`,
      authorizedRelease(),
    );
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
    const nowReleasable = await post(
      `/api/v1/custody/packets/${packetId}/movements`,
      authorizedRelease(),
    );
    expect(nowReleasable.status).toBe(201);
  });

  // Gated release over the wire: the refusal carries its own problem type, because a client shows
  // "this release still needs an identity check" differently from "that request was malformed".
  it("refuses a release that captures no authority or identity, then accepts it once captured", async () => {
    const safe = await createLocation("Gated safe", "safe");
    const ownerEntityId = await createPerson("Gated", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Gated release packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };

    const ungated = await post(`/api/v1/custody/packets/${packetId}/movements`, {
      kind: "released",
      borrower: { kind: "external", name: "A. Collector" },
    });
    expect(ungated.status).toBe(422);
    expect(await ungated.json()).toMatchObject({
      type: "https://api.magnacarta.esq/problems/custody-release-not-authorized",
    });

    // The refusal wrote nothing: the packet is still held, so the corrected retry a moment later is
    // an ordinary release rather than a movement on a packet the failed attempt already closed.
    const stillHeld = await get(`/api/v1/custody/packets/${packetId}`);
    expect(await stillHeld.json()).toMatchObject({ status: "held" });

    const authorized = await post(
      `/api/v1/custody/packets/${packetId}/movements`,
      authorizedRelease(),
    );
    expect(authorized.status).toBe(201);
    expect(await authorized.json()).toMatchObject({ packetStatus: "released" });

    // The capture is on the ledger row, which is the only place it could be worth anything: the row
    // cannot be updated or deleted, so what was recorded before the property left stays recorded.
    const history = await get(`/api/v1/custody/packets/${packetId}/movements`);
    const historyBody = (await history.json()) as {
      data: Array<{ kind: string; releaseAuthorityBasis: string | null }>;
    };
    expect(historyBody.data.find((movement) => movement.kind === "released")).toMatchObject({
      releaseAuthorityBasis: "owner collecting their own original in person",
    });
  });

  // Release capture on anything else would read as evidence of a check nobody made, on a movement
  // nothing gates.
  it("refuses release capture attached to a check-out (422)", async () => {
    const safe = await createLocation("Miscapture safe", "safe");
    const ownerEntityId = await createPerson("Miscapture", "Owner");
    const logged = await post("/api/v1/custody/packets", {
      name: "Miscaptured packet",
      owners: [{ entityId: ownerEntityId }],
      currentLocationId: safe,
    });
    const { id: packetId } = (await logged.json()) as { id: string };

    const response = await post(`/api/v1/custody/packets/${packetId}/movements`, {
      ...authorizedRelease(),
      kind: "checked_out",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      type: "https://api.magnacarta.esq/problems/custody-invalid-movement",
    });
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
    expect((await readJson<{ id: string }>(retry)).id).toBe(firstId);

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

// The stocktake surface, driven through the chokepoint against its own firm (the rate-limit note on
// stocktakeOwnerCookie explains why). What is asserted hardest here is the boundary: a full count
// runs end to end — open, sight, reconcile, close — and afterwards every packet is in exactly the
// state and the place it was before, with no ledger row the count wrote. There is no route that
// applies a reconciliation, and there is not meant to be one.
describe("stocktake — counting the shelves without changing the register", () => {
  // The tree, the owner, and the packets are built once and shared. Every test below reads the same
  // register; none of them writes to it, which is the property under test.
  const scaffold: {
    safe: string;
    shelf: string;
    matched: string;
    misplaced: string;
    missing: string;
    checkedOut: string;
  } = { safe: "", shelf: "", matched: "", misplaced: "", missing: "", checkedOut: "" };

  async function stocktakePost(path: string, body: unknown, key = crypto.randomUUID()) {
    return post(path, body, stocktakeOwnerCookie, key);
  }

  async function stocktakeGet(path: string, cookie = stocktakeOwnerCookie) {
    return get(path, cookie);
  }

  async function openCount(name: string, scopeLocationId?: string): Promise<string> {
    const response = await stocktakePost("/api/v1/custody/stocktakes", {
      name,
      ...(scopeLocationId === undefined ? {} : { scopeLocationId }),
    });
    expect(response.status).toBe(201);
    return (await readJson<{ id: string }>(response)).id;
  }

  beforeAll(async () => {
    async function makeLocation(name: string, kind: string, parentLocationId?: string) {
      const response = await stocktakePost("/api/v1/custody/locations", {
        name,
        kind,
        ...(parentLocationId === undefined ? {} : { parentLocationId }),
      });
      expect(response.status).toBe(201);
      return (await readJson<{ id: string }>(response)).id;
    }
    const office = await makeLocation("Stocktake office", "office");
    scaffold.safe = await makeLocation("Stocktake safe", "safe", office);
    scaffold.shelf = await makeLocation("Stocktake shelf", "shelf", scaffold.safe);

    const person = await stocktakePost("/api/v1/directory/persons", {
      given: "Stocktake",
      family: "Owner",
    });
    expect(person.status).toBe(201);
    const ownerEntityId = (await readJson<{ id: string }>(person)).id;

    async function logPacket(name: string, currentLocationId: string): Promise<string> {
      const response = await stocktakePost("/api/v1/custody/packets", {
        name,
        owners: [{ entityId: ownerEntityId }],
        currentLocationId,
      });
      expect(response.status).toBe(201);
      return (await readJson<{ id: string }>(response)).id;
    }
    scaffold.matched = await logPacket("Stocktake matched", scaffold.safe);
    scaffold.misplaced = await logPacket("Stocktake misplaced", scaffold.shelf);
    scaffold.missing = await logPacket("Stocktake missing", scaffold.safe);
    scaffold.checkedOut = await logPacket("Stocktake checked out", scaffold.safe);
    expect(
      (
        await stocktakePost(`/api/v1/custody/packets/${scaffold.checkedOut}/movements`, {
          kind: "checked_out",
          borrower: { kind: "external", name: "M. Alvarez (courier)" },
        })
      ).status,
    ).toBe(201);
  });

  it("counts a branch, reports every disagreement, proposes corrections, and moves nothing", async () => {
    const stocktakeId = await openCount("Annual count of the Stocktake safe", scaffold.safe);

    // One batch, the way a person with a scanner produces them.
    const sighted = await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/sightings`, {
      sightings: [
        { kind: "sighted", packetId: scaffold.matched, locationId: scaffold.safe },
        { kind: "sighted", packetId: scaffold.misplaced, locationId: scaffold.safe },
        { kind: "not_found", packetId: scaffold.missing, locationId: scaffold.safe },
        // The register says this one is out with a courier, and here it is on the shelf.
        { kind: "sighted", packetId: scaffold.checkedOut, locationId: scaffold.safe },
        {
          kind: "unregistered",
          locationId: scaffold.shelf,
          description: "Sealed envelope, no label",
        },
      ],
    });
    expect(sighted.status).toBe(201);
    expect((await readJson<{ ids: unknown[] }>(sighted)).ids).toHaveLength(5);

    const reconciliation = await stocktakeGet(
      `/api/v1/custody/stocktakes/${stocktakeId}/reconciliation`,
    );
    expect(reconciliation.status).toBe(200);
    const report = (await reconciliation.json()) as {
      matchedCount: number;
      missing: Array<{ packetId: string; proposedMovementKind: string | null }>;
      misplaced: Array<{
        packetId: string;
        proposedMovementKind: string;
        proposedToLocationId: string;
      }>;
      unexpected: Array<{ packetId: string; proposedMovementKind: string }>;
      unregistered: Array<{ description: string }>;
      frozenCounts: unknown;
      truncated: boolean;
      rowLimit: number;
    };
    expect(report.matchedCount).toBe(1);
    expect(report.missing.map((line) => line.packetId)).toEqual([scaffold.missing]);
    // A missing original proposes nothing: the honest answer to an empty shelf is an investigation.
    expect(report.missing[0]?.proposedMovementKind).toBeNull();
    expect(report.misplaced[0]).toMatchObject({
      packetId: scaffold.misplaced,
      proposedMovementKind: "moved",
      proposedToLocationId: scaffold.safe,
    });
    // `returned`, not `found`: the register says a courier has it and here it is on the shelf.
    expect(report.unexpected[0]).toMatchObject({
      packetId: scaffold.checkedOut,
      proposedMovementKind: "returned",
    });
    expect(report.unregistered[0]?.description).toBe("Sealed envelope, no label");
    // Nothing is frozen while the count is still running.
    expect(report.frozenCounts).toBeNull();
    // And the report says out loud that it read the whole register rather than a prefix of it. A
    // partial answer that looked complete would under-report missing originals.
    expect(report.truncated).toBe(false);
    expect(report.rowLimit).toBeGreaterThan(0);

    const closed = await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/close`, {});
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({
      status: "closed",
      counts: { matched: 1, missing: 1, misplaced: 1, unexpected: 1, unregistered: 1 },
      truncated: false,
    });

    // THE BOUNDARY. The count found four disagreements and corrected none of them: the misplaced
    // packet is still on the shelf the register named, the checked-out one is still out, and neither
    // has a movement the stocktake appended. Putting the register right is a person recording a
    // movement, which is the only way this register ever changes.
    const misplacedDetail = (await (
      await stocktakeGet(`/api/v1/custody/packets/${scaffold.misplaced}`)
    ).json()) as { status: string; locationPath: Array<{ id: string }> };
    expect(misplacedDetail.status).toBe("held");
    expect(misplacedDetail.locationPath.at(-1)?.id).toBe(scaffold.shelf);

    const history = (await (
      await stocktakeGet(`/api/v1/custody/packets/${scaffold.misplaced}/movements`)
    ).json()) as { data: Array<{ kind: string }> };
    expect(history.data.map((movement) => movement.kind)).toEqual(["logged"]);

    const checkedOutDetail = (await (
      await stocktakeGet(`/api/v1/custody/packets/${scaffold.checkedOut}`)
    ).json()) as { status: string };
    expect(checkedOutDetail.status).toBe("out");
  });

  it("records a retried batch once, then refuses observations and a second close (409)", async () => {
    const stocktakeId = await openCount("Retry and closure count");

    const key = crypto.randomUUID();
    const body = {
      sightings: [{ kind: "sighted", packetId: scaffold.matched, locationId: scaffold.safe }],
    };
    const first = await stocktakePost(
      `/api/v1/custody/stocktakes/${stocktakeId}/sightings`,
      body,
      key,
    );
    const replay = await stocktakePost(
      `/api/v1/custody/stocktakes/${stocktakeId}/sightings`,
      body,
      key,
    );
    expect(first.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());

    const sightings = (await (
      await stocktakeGet(`/api/v1/custody/stocktakes/${stocktakeId}/sightings`)
    ).json()) as { data: unknown[] };
    expect(sightings.data).toHaveLength(1);

    expect(
      (await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/close`, {})).status,
    ).toBe(200);

    // A finished count has produced a reconciliation somebody may have acted on.
    const late = await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/sightings`, body);
    expect(late.status).toBe(409);
    // The wire `type` is the registry's absolute problem URI, so the slug is matched as its suffix.
    expect(await late.json()).toMatchObject({
      type: expect.stringContaining("custody-stocktake-closed") as unknown as string,
    });
    expect(
      (await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/close`, {})).status,
    ).toBe(409);
  });

  it("abandons an unfinished count without freezing findings, and refuses a bare observation (422)", async () => {
    const stocktakeId = await openCount("Interrupted count");

    // An unregistered object with no description of what was found: that description is the only
    // record of the object anywhere, so the register refuses the observation without it.
    const bare = await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/sightings`, {
      sightings: [{ kind: "unregistered", locationId: scaffold.shelf }],
    });
    expect(bare.status).toBe(422);

    const closed = await stocktakePost(`/api/v1/custody/stocktakes/${stocktakeId}/close`, {
      abandoned: true,
    });
    expect(closed.status).toBe(200);
    // A half-finished walk must not report the safe as full of missing originals.
    expect(await closed.json()).toMatchObject({ status: "abandoned", counts: null });
    expect(
      await (await stocktakeGet(`/api/v1/custody/stocktakes/${stocktakeId}`)).json(),
    ).toMatchObject({ status: "abandoned", counts: null });
  });

  it("requires an Idempotency-Key on every write, custody:read on every read, and 404s an unknown count", async () => {
    const stocktakeId = await openCount("Contract count");

    for (const [path, body] of [
      ["/api/v1/custody/stocktakes", { name: "No key" }],
      [`/api/v1/custody/stocktakes/${stocktakeId}/sightings`, { sightings: [] }],
      [`/api/v1/custody/stocktakes/${stocktakeId}/close`, {}],
    ] as const) {
      expect((await postWithoutKey(path, body, stocktakeOwnerCookie)).status, path).toBe(400);
    }

    for (const path of [
      "/api/v1/custody/stocktakes",
      `/api/v1/custody/stocktakes/${stocktakeId}`,
      `/api/v1/custody/stocktakes/${stocktakeId}/sightings`,
      `/api/v1/custody/stocktakes/${stocktakeId}/reconciliation`,
    ]) {
      expect((await stocktakeGet(path, stocktakeNoPermissionCookie)).status, path).toBe(403);
    }
    expect(
      (await post("/api/v1/custody/stocktakes", { name: "Denied" }, stocktakeNoPermissionCookie))
        .status,
    ).toBe(403);

    // A well-formed handle for a count that does not exist — the shape has to pass the path-param
    // check so what is asserted is the 404 and not a 422 for a malformed identifier.
    const absent = `custodyStocktake_${"a".repeat(21)}`;
    expect((await stocktakeGet(`/api/v1/custody/stocktakes/${absent}`)).status).toBe(404);
    expect((await stocktakeGet(`/api/v1/custody/stocktakes/${absent}/reconciliation`)).status).toBe(
      404,
    );
  });
});
