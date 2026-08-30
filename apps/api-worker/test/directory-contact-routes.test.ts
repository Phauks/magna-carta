import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The contact-point surface, driven through the chokepoint over real Miniflare bindings: email
// addresses, telephone and fax numbers, postal addresses, and a person's life dates.
//
// It is a file of its own rather than more cases in directory-routes.test.ts because the rate
// limiter's window is per isolate and per identity, and one file's worth of requests is the budget:
// appending these there refused the last third of them with a 429 that said nothing about the code
// under test.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;

// Mirror a member carrying a named seeded role (the Read-only role grants no directory permission).
async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const roleResult = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .all<{ id: string }>();
  const role = roleResult.results[0];
  if (role === undefined) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Directory Contact Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await seedFirmKey(poolFirmId);

  const owner = await seedCredentialedUser("contact-owner@example.com", {
    userName: "Contact Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Contact Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("contact-owner@example.com");

  const readOnly = await seedCredentialedUser("contact-readonly@example.com", {
    userName: "Contact Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Contact Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("contact-readonly@example.com");
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function put(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

describe("contact points", () => {
  // Until these routes existed, `directory_email`, `directory_phone` and `directory_address` were
  // three tables nothing could reach, and a firm could not record a client's telephone number.
  async function seedPerson(given: string): Promise<string> {
    const response = await post("/api/v1/directory/persons", { given, family: "Contactable" });
    expect(response.status).toBe(201);
    return (await readJson<{ id: string }>(response)).id;
  }

  async function remove(path: string, cookie = ownerCookie) {
    return SELF.fetch(`https://example.com${path}`, {
      method: "DELETE",
      headers: authHeaders(cookie, true),
    });
  }

  it("records a telephone number and reads it back with its parts", async () => {
    const personId = await seedPerson("Reachable");
    const created = await post(`/api/v1/directory/entities/${personId}/phones`, {
      number: "+1 (702) 555-0143 ext. 22",
      contactSystem: "fax",
      contactUse: "work",
    });
    expect(created.status).toBe(201);

    const listed = await get(`/api/v1/directory/entities/${personId}/phones`);
    expect(listed.status).toBe(200);
    const body = await readJson<{
      data: { number: string; contactSystem: string; nationalNumber: string; extension: string }[];
    }>(listed);
    expect(body.data).toHaveLength(1);
    // The number as entered survives verbatim, and the split sits beside it.
    expect(body.data[0]?.number).toBe("+1 (702) 555-0143 ext. 22");
    expect(body.data[0]?.nationalNumber).toBe("7025550143");
    expect(body.data[0]?.extension).toBe("22");
    // Fax is a technology, so a delivery path can ask the question and get an answer.
    expect(body.data[0]?.contactSystem).toBe("fax");
  });

  it("records an address with no state and no five-digit postal code", async () => {
    const personId = await seedPerson("Abroad");
    const created = await post(`/api/v1/directory/entities/${personId}/addresses`, {
      street: "12 Rue de la Paix",
      streetTwo: "Bâtiment C",
      city: "Paris",
      postal: "75002",
      sortingCode: "CEDEX 09",
      country: "FR",
      addressUse: "business",
    });
    expect(created.status).toBe(201);

    const listed = await get(`/api/v1/directory/entities/${personId}/addresses`);
    const body = await readJson<{ data: { region: string | null; sortingCode: string }[] }>(listed);
    expect(body.data[0]?.region).toBeNull();
    expect(body.data[0]?.sortingCode).toBe("CEDEX 09");
  });

  it("answers all three channels in one read", async () => {
    const personId = await seedPerson("Everywhere");
    expect(
      (await post(`/api/v1/directory/entities/${personId}/emails`, { address: "a@example.com" }))
        .status,
    ).toBe(201);
    expect(
      (await post(`/api/v1/directory/entities/${personId}/phones`, { number: "+44 20 7946 0018" }))
        .status,
    ).toBe(201);
    expect(
      (await post(`/api/v1/directory/entities/${personId}/addresses`, { street: "1 High Street" }))
        .status,
    ).toBe(201);

    const response = await get(`/api/v1/directory/entities/${personId}/contact-points`);
    expect(response.status).toBe(200);
    const points = await readJson<{
      emails: unknown[];
      phones: unknown[];
      addresses: unknown[];
    }>(response);
    expect(points.emails).toHaveLength(1);
    expect(points.phones).toHaveLength(1);
    expect(points.addresses).toHaveLength(1);
  });

  it("carries the permission and the preference as two separate facts", async () => {
    const personId = await seedPerson("Particular");
    const phone = await post(`/api/v1/directory/entities/${personId}/phones`, {
      number: "+1 702 555 0143",
      preference: { permitted: false, note: "Asked us not to ring this line." },
    });
    const phoneId = (await readJson<{ id: string }>(phone)).id;
    await post(`/api/v1/directory/entities/${personId}/emails`, {
      address: "particular@example.com",
      preference: { preferred: true },
    });

    const points = await readJson<{
      emails: { state: { permitted: boolean; preferred: boolean } }[];
      phones: { state: { permitted: boolean; preferred: boolean; note: string | null } }[];
    }>(await get(`/api/v1/directory/entities/${personId}/contact-points`));
    // Not permitted, and the reason travels with the value rather than the row being deleted.
    expect(points.phones[0]?.state.permitted).toBe(false);
    expect(points.phones[0]?.state.note).toBe("Asked us not to ring this line.");
    // Permitted but not preferred, and preferred but not the withdrawn one: two different facts.
    expect(points.emails[0]?.state.permitted).toBe(true);
    expect(points.emails[0]?.state.preferred).toBe(true);
    expect(points.phones[0]?.state.preferred).toBe(false);

    // An edit that does not mention the permission does not restore it.
    expect(
      (await put(`/api/v1/directory/phones/${phoneId}`, { contactUse: "mobile" })).status,
    ).toBe(200);
    const after = await readJson<{ data: { state: { permitted: boolean } }[] }>(
      await get(`/api/v1/directory/entities/${personId}/phones`),
    );
    expect(after.data[0]?.state.permitted).toBe(false);
  });

  it("records a failed verification and keeps the address usable", async () => {
    const personId = await seedPerson("Returned");
    const created = await post(`/api/v1/directory/entities/${personId}/addresses`, {
      street: "1 High Street",
      city: "Ayr",
      country: "GB",
    });
    const addressId = (await readJson<{ id: string }>(created)).id;

    expect(
      (
        await put(`/api/v1/directory/addresses/${addressId}`, {
          verification: { status: "failed", detail: "Returned: no such number in street." },
        })
      ).status,
    ).toBe(200);

    const body = await readJson<{
      data: {
        street: string;
        state: { verificationStatus: string; verificationDetail: string; permitted: boolean };
      }[];
    }>(await get(`/api/v1/directory/entities/${personId}/addresses`));
    expect(body.data[0]?.state.verificationStatus).toBe("failed");
    expect(body.data[0]?.state.verificationDetail).toBe("Returned: no such number in street.");
    // Nothing is withdrawn or hidden by a failure: it is a record and a warning, never a gate.
    expect(body.data[0]?.state.permitted).toBe(true);
    expect(body.data[0]?.street).toBe("1 High Street");
  });

  it("removes a contact point once, and reports 404 on a second attempt", async () => {
    const personId = await seedPerson("Departing");
    const created = await post(`/api/v1/directory/entities/${personId}/emails`, {
      address: "departing@example.com",
    });
    const emailId = (await readJson<{ id: string }>(created)).id;

    expect((await remove(`/api/v1/directory/emails/${emailId}`)).status).toBe(200);
    expect((await remove(`/api/v1/directory/emails/${emailId}`)).status).toBe(404);
    const body = await readJson<{ data: unknown[] }>(
      await get(`/api/v1/directory/entities/${personId}/emails`),
    );
    expect(body.data).toHaveLength(0);
  });

  it("refuses an unusable number, an empty address, and a value outside the catalog", async () => {
    const personId = await seedPerson("Malformed");
    expect(
      (await post(`/api/v1/directory/entities/${personId}/phones`, { number: "call the office" }))
        .status,
    ).toBe(422);
    expect((await post(`/api/v1/directory/entities/${personId}/addresses`, {})).status).toBe(422);
    // Outside the catalog is refused by the contract, which is what makes the open column CHECK
    // underneath it safe: a committed migration is immutable, so the catalog cannot be closed at
    // rest without a fleet migration every time it grows.
    expect(
      (
        await post(`/api/v1/directory/entities/${personId}/phones`, {
          number: "+1 702 555 0143",
          contactSystem: "telex",
        })
      ).status,
    ).toBe(422);
  });

  it("refuses a contact write from a member without directory:edit", async () => {
    const personId = await seedPerson("Guarded");
    const response = await post(
      `/api/v1/directory/entities/${personId}/phones`,
      { number: "+1 702 555 0143" },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

describe("a person's life dates", () => {
  it("records a date of birth that can actually be read back", async () => {
    const created = await post("/api/v1/directory/persons", { given: "Dated", family: "Person" });
    const personId = (await readJson<{ id: string }>(created)).id;

    expect(
      (await put(`/api/v1/directory/persons/${personId}/life-dates`, { dateOfBirth: "1971-04-02" }))
        .status,
    ).toBe(200);

    const person = await readJson<{ dateOfBirth: string; deceased: boolean }>(
      await get(`/api/v1/directory/persons/${personId}`),
    );
    expect(person.dateOfBirth).toBe("1971-04-02");
    expect(person.deceased).toBe(false);
  });

  it("takes a date of death and infers that the person died", async () => {
    const created = await post("/api/v1/directory/persons", { given: "Late", family: "Person" });
    const personId = (await readJson<{ id: string }>(created)).id;

    expect(
      (await put(`/api/v1/directory/persons/${personId}/life-dates`, { dateOfDeath: "2026-01-09" }))
        .status,
    ).toBe(200);
    const person = await readJson<{ dateOfDeath: string; deceased: boolean }>(
      await get(`/api/v1/directory/persons/${personId}`),
    );
    expect(person.dateOfDeath).toBe("2026-01-09");
    expect(person.deceased).toBe(true);
  });

  it("refuses a date that names no day", async () => {
    const created = await post("/api/v1/directory/persons", { given: "Impossible", family: "Day" });
    const personId = (await readJson<{ id: string }>(created)).id;
    const response = await put(`/api/v1/directory/persons/${personId}/life-dates`, {
      dateOfBirth: "2026-02-30",
    });
    expect(response.status).toBe(422);
  });
});
