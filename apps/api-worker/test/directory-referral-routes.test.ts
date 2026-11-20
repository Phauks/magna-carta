import { env, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// How a client found the firm, through the chokepoint over real Miniflare bindings: the firm's list
// of referral sources, and a record's referral. Pinned here is what a screen cannot enforce for
// itself: a record is never its own referrer, a retired source is not a new choice, and every write
// takes the directory's own edit permission.

let ownerCookie: string;
let readerCookie: string;
let clientId: string;
let referrerId: string;

const ORIGIN = "https://example.com";
const ANOTHER_ATTORNEY = "directoryReferralSource_anotherAttorney000000";

interface ReferralBody {
  referral: {
    source: { id: string; name: string; archived: boolean } | null;
    referrer: { entityId: string; displayName: string | null } | null;
  } | null;
}

function write(
  method: string,
  path: string,
  body: unknown,
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      cookie,
      origin: ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function createPerson(given: string, family: string): Promise<string> {
  const created = await write("POST", "/api/v1/directory/persons", { given, family });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId: FirmId = (await seedFirm({ name: "Referral Test Firm" })).firmId;

  const owner = await seedCredentialedUser("referral-owner@example.com", {
    userName: "Referral Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Referral Owner", firmId);
  ownerCookie = await signInForSessionCookie("referral-owner@example.com");

  const reader = await seedCredentialedUser("referral-reader@example.com", {
    userName: "Referral Reader",
    firmId,
  });
  await mirrorMemberWithRole(reader.userId, "Referral Reader", firmId, "Read-only");
  readerCookie = await signInForSessionCookie("referral-reader@example.com");

  clientId = await createPerson("Margaret", "Ellison");
  referrerId = await createPerson("Daniel", "Okafor");
});

describe("the referral source list", () => {
  it("arrives seeded and readable by any member", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/directory/referral-sources`, {
      headers: { cookie: readerCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string }[] };
    expect(body.data.map((source) => source.name)).toContain("Another Attorney");
  });

  it("takes a new source, then moves and retires it", async () => {
    const created = await write("POST", "/api/v1/directory/referral-sources", {
      name: "Bar Association",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const source = (await created.json()) as { id: string; position: number };

    const moved = await write("PATCH", `/api/v1/directory/referral-sources/${source.id}`, {
      position: 0,
      archived: true,
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ position: 0, archived: true });

    // Retired, it is refused as a new choice.
    const refused = await write("PUT", `/api/v1/directory/entities/${referrerId}/referral`, {
      sourceId: source.id,
      referrerEntityId: null,
    });
    expect(refused.status).toBe(422);
  });

  it("refuses a member without directory:edit", async () => {
    const response = await write(
      "POST",
      "/api/v1/directory/referral-sources",
      { name: "Radio" },
      readerCookie,
    );
    expect(response.status).toBe(403);
  });
});

describe("a record's referral", () => {
  it("answers an explicit null before there is one", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/directory/entities/${clientId}/referral`, {
      headers: { cookie: readerCookie },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as ReferralBody).referral).toBeNull();
  });

  it("is recorded with a source and a referrer, read back, and removed", async () => {
    const path = `/api/v1/directory/entities/${clientId}/referral`;
    const recorded = await write("PUT", path, {
      sourceId: ANOTHER_ATTORNEY,
      referrerEntityId: referrerId,
    });
    expect(recorded.status, await recorded.clone().text()).toBe(200);
    const body = (await recorded.json()) as ReferralBody;
    expect(body.referral?.source?.name).toBe("Another Attorney");
    expect(body.referral?.referrer).toMatchObject({
      entityId: referrerId,
      displayName: "Daniel Okafor",
    });

    const read = await SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: ownerCookie } });
    expect(await read.json()).toEqual(body);

    const removed = await write("PUT", path, { sourceId: null, referrerEntityId: null });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as ReferralBody).referral).toBeNull();
  });

  it("refuses a record named as its own referrer", async () => {
    const response = await write("PUT", `/api/v1/directory/entities/${clientId}/referral`, {
      sourceId: null,
      referrerEntityId: clientId,
    });
    expect(response.status).toBe(422);
  });

  it("refuses a member without directory:edit", async () => {
    const response = await write(
      "PUT",
      `/api/v1/directory/entities/${clientId}/referral`,
      { sourceId: ANOTHER_ATTORNEY, referrerEntityId: null },
      readerCookie,
    );
    expect(response.status).toBe(403);
  });
});
