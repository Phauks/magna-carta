import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The permission split the postage credential exists to make possible, exercised end to end.
//
// A firm's postage key is sealed in `integration_credential`, whose decrypt is gated on
// integrations:useConnection — NOT on firm:manageSecrets, which would have meant handing everyone who
// mails a parcel read access to every secret the firm holds. The split only means something if a
// member who holds the shipping key and not the credential key is actually refused, and refused in a
// way that names the remedy: these tests are that proof.
//
// They also pin the shape of the refusal. A member who may not decrypt the credential must not be
// told the firm has no postage account — the account is connected, and that answer would send them,
// and whoever they escalate to, hunting a connection fault that does not exist.

const ROUTE_BASE = "https://example.com/api/v1";

function fakeEasyPost(): HttpClient {
  return {
    async request() {
      // Deliberately unreachable for the refused member: a credential that cannot be decrypted means
      // no adapter is ever constructed, so a call arriving here would itself be the bug.
      throw new Error("the carrier must not be reached without a decrypted credential");
    },
  };
}

const app = createApp({ pluginRuntime: { httpClient: fakeEasyPost() } });

let firmId: FirmId;
let keyCounter = 0;

function authedJson(cookie: string, withIdempotencyKey: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withIdempotencyKey ? { "Idempotency-Key": `ship-perm-${keyCounter++}` } : {}),
  };
}

// A role holding shipping:manage and nothing else — the shape a firm creates the moment it decides
// that mailing is an assistant's job rather than a partner's. Built inline rather than through the
// seeded-role helper precisely because no seeded role has this shape: Admin holds both keys,
// which is why the collision this guards against stayed invisible until it was looked for.
async function mirrorMemberWhoMayShipButNotDecrypt(
  userId: UserId,
  displayName: string,
  // Role names are unique within a firm, so a second member of this shape needs a role of its own.
  roleName = "Mailroom",
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const roleId = newIdentifier("role");
  await firmDatabase
    .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
    .bind(roleId, roleName, new Date().toISOString())
    .run();
  await firmDatabase
    .prepare("INSERT INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind(newIdentifier("rolePermission"), roleId, "shipping:manage")
    .run();
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(roleId, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Mailroom Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await seedFirmKey(firmId);

  // An administrator connects the postage account, so the credential genuinely exists and is sealed.
  const { userId } = await seedCredentialedUser("admin@mailroom.example", {
    userName: "Admin",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Admin", firmId);
  const adminCookie = await signInForSessionCookie("admin@mailroom.example");
  const connect = await app.request(
    `${ROUTE_BASE}/integrations/shipping/connection`,
    {
      method: "POST",
      headers: authedJson(adminCookie, true),
      body: JSON.stringify({ apiKey: "ezk_test" }),
    },
    env,
  );
  expect(connect.status).toBe(201);
});

const address = {
  name: "Jane",
  street1: "1 Main St",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
};

describe("the postage credential's permission gate", () => {
  it("lets a member without integrations:useConnection draft a shipment", async () => {
    const { userId } = await seedCredentialedUser("clerk@mailroom.example", {
      userName: "Clerk",
      firmId,
    });
    await mirrorMemberWhoMayShipButNotDecrypt(userId, "Clerk");
    const cookie = await signInForSessionCookie("clerk@mailroom.example");

    // A draft needs no carrier and therefore no credential. It must keep working, or the gate would
    // have cost the member the half of the surface that never needed a decrypt.
    const create = await app.request(
      `${ROUTE_BASE}/shipments`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({
          from: address,
          to: address,
          parcel: { weightOz: 8 },
        }),
      },
      env,
    );
    expect(create.status).toBe(201);
  });

  it("refuses the rate-shop with 403 and names the grant, not a connection fault", async () => {
    const cookie = await signInForSessionCookie("clerk@mailroom.example");
    const create = await app.request(
      `${ROUTE_BASE}/shipments`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({ from: address, to: address, parcel: { weightOz: 8 } }),
      },
      env,
    );
    const { id } = (await create.json()) as { id: string };

    const rates = await app.request(
      `${ROUTE_BASE}/shipments/${id}/rates`,
      { method: "POST", headers: authedJson(cookie, true), body: "{}" },
      env,
    );

    // 403, not 409. The firm IS connected; this member may not decrypt what it connected with.
    expect(rates.status).toBe(403);
    const problem = (await rates.json()) as { detail: string };
    expect(problem.detail).toContain("integrations:useConnection");
  });

  it("lets the administrator, who holds both keys, reach the carrier", async () => {
    // The control: the same route, the same connected account, a principal holding the grant. It
    // reaches the adapter — which this suite's fake refuses loudly — proving the refusal above is the
    // credential gate rather than anything else on the path.
    const cookie = await signInForSessionCookie("admin@mailroom.example");
    const create = await app.request(
      `${ROUTE_BASE}/shipments`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({ from: address, to: address, parcel: { weightOz: 8 } }),
      },
      env,
    );
    const { id } = (await create.json()) as { id: string };

    const rates = await app.request(
      `${ROUTE_BASE}/shipments/${id}/rates`,
      { method: "POST", headers: authedJson(cookie, true), body: "{}" },
      env,
    );
    expect(rates.status).not.toBe(403);
  });
});

/*
 * Writing the credential is the administrator's act, not the mailroom's.
 *
 * The credential store deliberately does no permission check on a write — it defers to the route — so
 * the route's own permission is the only gate there is. It used to be shipping:manage, the same key
 * as drafting a shipment, which let any member who could draft one swap the firm's key for one on an
 * account they control (after which every shipment an administrator bought, with its clients' names
 * and addresses, went to that account) or switch the firm's postage off outright. These pin both
 * doors shut for exactly the member who is otherwise trusted with shipping, and pin that nothing was
 * written — a 403 raised after a write would pass a status assertion and still be the bug.
 */
describe("who may change the postage account", () => {
  async function storedCiphertext(): Promise<string | null> {
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const row = await firmDatabase
      .prepare("SELECT ciphertext FROM integration_credential")
      .first<{ ciphertext: string }>();
    return row?.ciphertext ?? null;
  }

  let mailerCookie: string;

  beforeAll(async () => {
    const { userId } = await seedCredentialedUser("mailer@mailroom.example", {
      userName: "Mailer",
      firmId,
    });
    await mirrorMemberWhoMayShipButNotDecrypt(userId, "Mailer", "Postroom");
    mailerCookie = await signInForSessionCookie("mailer@mailroom.example");
  });

  it("refuses a member with only shipping:manage who tries to replace the key, and writes nothing", async () => {
    const before = await storedCiphertext();
    expect(before).not.toBeNull();

    const replace = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(mailerCookie, true),
        body: JSON.stringify({ apiKey: "ezk-an-account-the-member-controls" }),
      },
      env,
    );
    expect(replace.status).toBe(403);
    expect(await storedCiphertext()).toBe(before);
  });

  it("refuses the same member who tries to disconnect, and the firm stays connected", async () => {
    const disconnect = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      { method: "DELETE", headers: authedJson(mailerCookie, true) },
      env,
    );
    expect(disconnect.status).toBe(403);

    // Reading whether the firm is connected stays on shipping:manage: the register says "no account
    // is connected" from it, and that sentence is for exactly this member.
    const state = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      { method: "GET", headers: authedJson(mailerCookie, false) },
      env,
    );
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ connected: true });
  });

  it("still lets the administrator replace the key", async () => {
    const before = await storedCiphertext();
    const adminCookie = await signInForSessionCookie("admin@mailroom.example");
    const replace = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(adminCookie, true),
        body: JSON.stringify({ apiKey: "ezk_test_rotated" }),
      },
      env,
    );
    expect(replace.status).toBe(201);
    // Re-sealed, so the stored bytes moved: the control for the "nothing written" assertions above.
    expect(await storedCiphertext()).not.toBe(before);
  });
});
