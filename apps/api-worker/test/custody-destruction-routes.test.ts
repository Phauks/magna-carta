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
import type { ProblemBody } from "../src/http/contracts/problem.ts";

// The destruction surface and the will-deposit duty lookup, driven through the chokepoint over real
// Miniflare bindings.
//
// This block seeds its OWN firm rather than sharing the register suite's. The chokepoint's rate-limit
// key is `firm:<firmId>`, so a block that raises, approves, refuses, and executes a handful of
// requests — each with its scaffolding of locations, people, packets and items — would otherwise
// spend the register suite's window and start handing whichever test ran last a 429.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let approverCookie: string;
let readOnlyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

async function mirrorMemberWithReadOnlyGrant(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: clock.now() }).run();
  await database
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "custody:read", clock.now())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Custody Destruction Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("custody-destruction-owner@example.com", {
    userName: "Destruction Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Destruction Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("custody-destruction-owner@example.com");

  // The second person. Destroying a client's original takes two, and a test that only ever posts as
  // one of them proves nothing about the rule.
  const approver = await seedCredentialedUser("custody-destruction-approver@example.com", {
    userName: "Destruction Approver",
    firmId,
  });
  await mirrorMemberWithOwnerRole(approver.userId, "Destruction Approver", firmId);
  approverCookie = await signInForSessionCookie("custody-destruction-approver@example.com");

  const readOnly = await seedCredentialedUser("custody-destruction-readonly@example.com", {
    userName: "Destruction Read Only",
    firmId,
  });
  await mirrorMemberWithReadOnlyGrant(firmDatabase, readOnly.userId, "Destruction Read Only");
  readOnlyCookie = await signInForSessionCookie("custody-destruction-readonly@example.com");
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

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function createPacket(
  name: string,
  options: { intrinsicValue?: boolean } = {},
): Promise<string> {
  const location = await post("/api/v1/custody/locations", {
    name: `${name} shelf`,
    kind: "shelf",
  });
  expect(location.status).toBe(201);
  const { id: locationId } = (await location.json()) as { id: string };

  const person = await post("/api/v1/directory/persons", { given: "Owner", family: name });
  expect(person.status).toBe(201);
  const { id: entityId } = (await person.json()) as { id: string };

  const logged = await post("/api/v1/custody/packets", {
    name,
    owners: [{ entityId }],
    currentLocationId: locationId,
  });
  expect(logged.status).toBe(201);
  const { id: packetId } = (await logged.json()) as { id: string };

  if (options.intrinsicValue !== undefined) {
    const item = await post(`/api/v1/custody/packets/${packetId}/items`, {
      description: `Contents of ${name}`,
      intrinsicValue: options.intrinsicValue,
    });
    expect(item.status).toBe(201);
  }
  return packetId;
}

async function raise(packetId: string, basis = "superseded copies, client instructed in writing") {
  const response = await post("/api/v1/custody/destruction-requests", { packetId, basis });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

describe("the destruction routes", () => {
  it("raises, approves as a second person, and executes onto the movement ledger", async () => {
    const packetId = await createPacket("Routine correspondence", { intrinsicValue: false });
    const requestId = await raise(packetId);

    // Raising destroys nothing, and the request shows in the pending queue.
    const pending = await get("/api/v1/custody/destruction-requests?outcome=pending");
    expect(pending.status).toBe(200);
    const queue = (await pending.json()) as { data: { id: string; outcome: string | null }[] };
    expect(queue.data.some((row) => row.id === requestId && row.outcome === null)).toBe(true);

    const approved = await post(
      `/api/v1/custody/destruction-requests/${requestId}/approve`,
      {},
      approverCookie,
    );
    expect(approved.status).toBe(200);

    const executed = await post(
      `/api/v1/custody/destruction-requests/${requestId}/execute`,
      { method: "cross-cut shredded, witnessed" },
      approverCookie,
    );
    expect(executed.status).toBe(200);
    const result = (await executed.json()) as { movementId: string; packetId: string };
    expect(result.movementId).toMatch(/^custodyMovement_/);

    // The destruction is on the same append-only ledger as everything else, not a parallel write.
    const history = await get(`/api/v1/custody/packets/${packetId}/movements`);
    const ledger = (await history.json()) as { data: { id: string; kind: string }[] };
    expect(ledger.data.some((movement) => movement.id === result.movementId)).toBe(true);

    const packet = await get(`/api/v1/custody/packets/${packetId}`);
    expect((await readJson<{ status: string }>(packet)).status).toBe("destroyed");
  });

  it("refuses an approval by the person who raised the request", async () => {
    const packetId = await createPacket("Self approval", { intrinsicValue: false });
    const requestId = await raise(packetId);
    const response = await post(`/api/v1/custody/destruction-requests/${requestId}/approve`, {});
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("custody-approver-must-differ");
  });

  it("refuses execution before a second person has approved", async () => {
    const packetId = await createPacket("Unapproved", { intrinsicValue: false });
    const requestId = await raise(packetId);
    const response = await post(
      `/api/v1/custody/destruction-requests/${requestId}/execute`,
      {},
      approverCookie,
    );
    expect(response.status).toBe(409);
    expect((await readJson<ProblemBody>(response)).type).toContain(
      "custody-destruction-not-actionable",
    );
  });

  it("refuses a request while a hold is in force", async () => {
    const packetId = await createPacket("Held packet", { intrinsicValue: false });
    const hold = await post(`/api/v1/custody/packets/${packetId}/holds`, {
      kind: "legal",
      reason: "estate dispute",
    });
    expect(hold.status).toBe(201);

    const response = await post("/api/v1/custody/destruction-requests", {
      packetId,
      basis: "routine",
    });
    expect(response.status).toBe(409);
    expect((await readJson<ProblemBody>(response)).type).toContain("custody-hold-blocks-action");
  });

  // The one hard policy, and the surface carries no way round it: no override field on the request,
  // no query parameter on the execute, and no second endpoint.
  it("refuses an irreplaceable original outright, with no override reachable on the surface", async () => {
    const packetId = await createPacket("Original will", { intrinsicValue: true });

    const refused = await post("/api/v1/custody/destruction-requests", {
      packetId,
      basis: "retention cycle reached",
    });
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).type).toContain(
      "custody-intrinsic-value-not-destructible",
    );

    // Every field a caller might reach for changes nothing: the refusal fires exactly as it did
    // without them, because no such field exists in the contract for the handler to read. "There is
    // no override" is a statement about what the surface accepts, not a hope about who tries.
    for (const override of [
      { force: true },
      { override: true },
      { intrinsicValueOverride: true },
      { acknowledgeIntrinsicValue: true },
    ]) {
      const attempted = await post("/api/v1/custody/destruction-requests", {
        packetId,
        basis: "retention cycle reached",
        ...override,
      });
      expect(attempted.status).toBe(422);
    }

    // And the ordinary movement path, which is not part of this workflow at all, refuses it too.
    const movement = await post(`/api/v1/custody/packets/${packetId}/movements`, {
      kind: "destroyed",
    });
    expect(movement.status).toBe(422);
    expect((await readJson<ProblemBody>(movement)).type).toContain(
      "custody-intrinsic-value-not-destructible",
    );

    const packet = await get(`/api/v1/custody/packets/${packetId}`);
    expect((await readJson<{ status: string }>(packet)).status).toBe("held");
  });

  it("refuses to re-decide a request that was already refused", async () => {
    const packetId = await createPacket("Refused once", { intrinsicValue: false });
    const requestId = await raise(packetId);
    const refused = await post(
      `/api/v1/custody/destruction-requests/${requestId}/refuse`,
      { reason: "the client asked us to keep them" },
      approverCookie,
    );
    expect(refused.status).toBe(200);

    const again = await post(
      `/api/v1/custody/destruction-requests/${requestId}/approve`,
      {},
      approverCookie,
    );
    expect(again.status).toBe(409);
  });

  it("refuses a destruction request from a member with read access only", async () => {
    const packetId = await createPacket("Read only", { intrinsicValue: false });
    const response = await post(
      "/api/v1/custody/destruction-requests",
      { packetId, basis: "routine" },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
    // The same member can still read the queue: reading a register and ending property in it are
    // genuinely different capabilities.
    expect((await get("/api/v1/custody/destruction-requests", readOnlyCookie)).status).toBe(200);
  });
});

describe("the will-deposit duty lookup", () => {
  it("returns Nevada's 30-day duty with the statutory text quoted and cited", async () => {
    const response = await get("/api/v1/custody/will-deposit-duties?jurisdiction=US-NV");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jurisdictionKey: string;
      duties: {
        key: string;
        citation: string;
        deadlineDays: number | null;
        statutoryText: string;
      }[];
      capabilities: { key: string; available: boolean }[];
      encodedSubJurisdictionKeys: string[];
    };
    expect(body.jurisdictionKey).toBe("US-NV");
    const delivery = body.duties.find((duty) => duty.key === "delivery-of-will-after-death");
    expect(delivery?.deadlineDays).toBe(30);
    expect(delivery?.citation).toBe("NRS 136.050(1), (3), (4), (5)");
    expect(delivery?.statutoryText).toContain(
      "within 30 days after knowledge of the death of the person who executed the will",
    );
    // The verified negative rides along, so a firm cannot read "no entry" as "no such procedure".
    expect(
      body.capabilities.find((capability) => capability.key === "lifetime-deposit-with-a-court")
        ?.available,
    ).toBe(false);
    expect([...body.encodedSubJurisdictionKeys].sort()).toEqual(["US-NV-02", "US-NV-08"]);
  });

  it("returns the county lodging rule below the state, with the state's duties above it", async () => {
    const response = await get("/api/v1/custody/will-deposit-duties?jurisdiction=US-NV-08");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { duties: { key: string; citation: string }[] };
    expect(body.duties[0]?.key).toBe("lodging-the-original-with-a-probate-petition");
    expect(body.duties[0]?.citation).toBe("EDCR 4.40(a)–(b)");
    expect(body.duties.some((duty) => duty.key === "delivery-of-will-after-death")).toBe(true);
  });

  it("refuses an unencoded jurisdiction rather than falling back to anything", async () => {
    const response = await get("/api/v1/custody/will-deposit-duties?jurisdiction=US-CA");
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string; detail: string };
    expect(problem.type).toContain("custody-jurisdiction-unavailable");
    expect(problem.detail).toContain("no verified will-deposit duties are encoded");
  });

  // An unencoded county under an encoded state refuses on its own terms, and the detail says the
  // state IS encoded — so nobody reads the refusal as "the county requires nothing".
  it("refuses an unencoded sub-jurisdiction and names its encoded parent", async () => {
    const response = await get("/api/v1/custody/will-deposit-duties?jurisdiction=US-NV-01");
    expect(response.status).toBe(422);
    expect((await readJson<ProblemBody>(response)).detail).toContain("US-NV is encoded");
  });
});
