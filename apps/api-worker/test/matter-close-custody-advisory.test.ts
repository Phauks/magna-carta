import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The matter-close ADVISORY over real Miniflare bindings: closing a matter surfaces the physical
// originals the firm still holds against it, and never blocks on them.
//
// This is the counterpart of the trust close gate and is deliberately the opposite shape. Money left
// in a client ledger refuses the close outright; property left in the safe does not, because a firm
// holds a client's will for decades after the last matter for that client closed. What is proved
// here is that the composition root registers the notice at all, and that it arrives on a response
// that closed the matter — an advisory that could refuse would be a precondition with a friendlier
// name.
//
// Its own firm, because the chokepoint's per-firm rate bucket is shared by every request a file makes.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;

function post(path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      // Only a request that carries a body says it is JSON, as the web client does
      // (apps/web/src/lib/api/request.ts): the close body is optional, and an empty body declared
      // as JSON is refused as malformed before the handler runs.
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

async function openMatter(title: string): Promise<string> {
  const created = await post("/api/v1/matters", {
    title,
    status: "open",
    responsibleMemberId: ownerUserId,
  });
  expect(created.status).toBe(201);
  return (await readJson<{ matterId: string }>(created)).matterId;
}

interface CloseBody {
  matterId: string;
  notices: { code: string; message: string }[];
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Matter Close Custody Advisory Firm" })).firmId;

  const owner = await seedCredentialedUser("matter-close-custody-owner@example.com", {
    userName: "Advisory Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Advisory Owner", firmId);
  ownerCookie = await signInForSessionCookie("matter-close-custody-owner@example.com");

  // Creating a matter as open draws its number, so the firm needs a scheme that renders without a
  // Location. Nothing in this block is about numbering; this is scaffolding.
  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "ADV-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });
});

describe("closing a matter that has custody packets against it", () => {
  it("closes, and says what the firm still holds", async () => {
    const matterId = await openMatter("Estate of A. Client");

    const location = await post("/api/v1/custody/locations", {
      name: "Advisory safe",
      kind: "safe",
    });
    expect(location.status).toBe(201);
    const { id: locationId } = (await location.json()) as { id: string };
    const person = await post("/api/v1/directory/persons", { given: "A", family: "Client" });
    expect(person.status).toBe(201);
    const { id: entityId } = (await person.json()) as { id: string };
    const logged = await post("/api/v1/custody/packets", {
      name: "Original will and deeds",
      owners: [{ entityId }],
      currentLocationId: locationId,
      matterId,
    });
    expect(logged.status).toBe(201);

    const closed = await post(`/api/v1/matters/${matterId}/close`);

    // Closed. Not refused, not a 409, not a problem document.
    expect(closed.status).toBe(200);
    const body = (await closed.json()) as CloseBody;
    expect(body.matterId).toBe(matterId);
    expect(body.notices).toHaveLength(1);
    expect(body.notices[0]?.code).toBe("custody-packets-linked");
    expect(body.notices[0]?.message).toContain("1 packet");
    // The notice carries a count and nothing identifying: closing a matter needs no custody
    // permission, and that a firm holds an original for a named person is a disclosure in itself.
    expect(body.notices[0]?.message).not.toContain("Original will");
    expect(body.notices[0]?.message).not.toContain("Client");

    // The matter really is closed, and the packet is untouched by the close.
    const matter = await get(`/api/v1/matters/${matterId}`);
    expect((await readJson<{ status: string }>(matter)).status).toBe("closed");
    const packets = await get(`/api/v1/custody/packets?matterId=${matterId}`);
    const listed = (await packets.json()) as { data: { status: string }[] };
    expect(listed.data[0]?.status).toBe("held");
  });

  it("closes a matter with no custody packets and says nothing", async () => {
    const matterId = await openMatter("Nothing In The Safe");
    const closed = await post(`/api/v1/matters/${matterId}/close`);
    expect(closed.status).toBe(200);
    expect((await readJson<{ notices: unknown[] }>(closed)).notices).toEqual([]);
  });
});
