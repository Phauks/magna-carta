import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "./support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmlessCredentialedUser,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// THE PORTAL LANE. A portal route is reached by a portal client and nobody else, and a firm-scoped
// one only through the client's own ACTIVE membership in the firm its path names, in an active firm.
// Every other caller and every other firm meets the same reserved 404, so the lane cannot be used to
// learn which firms exist or which ones share with whom.

let firmId: FirmId;
let otherFirmId: FirmId;
let staffCookie: string;
let clientCookie: string;
let clientUserId: string;
const CLIENT_EMAIL = "portal-lane-client@example.com";
const PERSON_ID = "directoryPerson_portalLaneClient";

let nextAddress = 0;
function freshAddress(): string {
  nextAddress += 1;
  return `198.51.100.${nextAddress % 250}`;
}

function get(path: string, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: {
      accept: "application/json",
      "cf-connecting-ip": freshAddress(),
      ...(cookie === undefined ? {} : { cookie }),
    },
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Lane and Partners" })).firmId;
  otherFirmId = (await seedFirm({ name: "Unrelated Firm" })).firmId;
  const staff = await seedCredentialedUser("portal-lane-staff@example.com", { firmId });
  await mirrorMemberWithOwnerRole(staff.userId, "Lane Staff", firmId);
  staffCookie = await signInForSessionCookie("portal-lane-staff@example.com");

  const now = new Date().toISOString();
  await firmDatabaseHandle(firmId)
    .prepare(
      "INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
    )
    .bind(PERSON_ID, "Morgan Ellery", now)
    .run();

  clientUserId = (await seedFirmlessCredentialedUser(CLIENT_EMAIL, { userName: "Morgan Ellery" }))
    .userId;
  clientCookie = await signInForSessionCookie(CLIENT_EMAIL);
  const issued = await SELF.fetch("https://example.com/api/v1/invitations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: staffCookie,
      "idempotency-key": newIdentifier("idempotencyRecord"),
    },
    body: JSON.stringify({
      kind: "clientOfFirm",
      email: CLIENT_EMAIL,
      name: "Morgan Ellery",
      lastName: "Ellery",
      dateOfBirth: "1979-03-14",
      directoryEntityId: PERSON_ID,
    }),
  });
  const { code } = (await issued.json()) as { code: string };
  expect(issued.status).toBe(201);
  const redeemed = await SELF.fetch("https://example.com/api/v1/me/invitation-redemptions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: clientCookie,
      "cf-connecting-ip": freshAddress(),
    },
    body: JSON.stringify({ code, lastName: "Ellery", dateOfBirth: "1979-03-14" }),
  });
  expect(redeemed.status, await redeemed.clone().text()).toBe(200);
});

describe("the client's account", () => {
  it("lists the firms that share with them, and nothing else", async () => {
    const response = await get("/api/portal/v1/account", clientCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "Morgan Ellery",
      email: CLIENT_EMAIL,
      firms: [{ firmId, firmName: "Lane and Partners" }],
    });
  });

  it("is absent to a member of staff", async () => {
    expect((await get("/api/portal/v1/account", staffCookie)).status).toBe(404);
  });

  it("asks a caller with no session to sign in", async () => {
    expect((await get("/api/portal/v1/account")).status).toBe(401);
  });
});

describe("one firm", () => {
  it("answers the firm and the name it knows the client by", async () => {
    const response = await get(`/api/portal/v1/firms/${firmId}`, clientCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      firmId,
      firmName: "Lane and Partners",
      personName: "Morgan Ellery",
    });
  });

  it("answers a firm the client was never invited to as absent", async () => {
    expect((await get(`/api/portal/v1/firms/${otherFirmId}`, clientCookie)).status).toBe(404);
  });

  it("answers a firm that does not exist the same way", async () => {
    expect((await get("/api/portal/v1/firms/firm_doesNotExist", clientCookie)).status).toBe(404);
  });

  it("is absent to the firm's own staff", async () => {
    expect((await get(`/api/portal/v1/firms/${firmId}`, staffCookie)).status).toBe(404);
  });

  it("closes the moment the membership ends, and opens again when it is restored", async () => {
    const setStatus = (status: string) =>
      env.DB_CONTROL.prepare(
        "UPDATE portal_membership SET status = ?3 WHERE principal_id = ?1 AND firm_id = ?2",
      )
        .bind(clientUserId, firmId, status)
        .run();
    await setStatus("suspended");
    try {
      expect((await get(`/api/portal/v1/firms/${firmId}`, clientCookie)).status).toBe(404);
      const account = (await (await get("/api/portal/v1/account", clientCookie)).json()) as {
        firms: unknown[];
      };
      expect(account.firms).toEqual([]);
    } finally {
      await setStatus("active");
    }
    expect((await get(`/api/portal/v1/firms/${firmId}`, clientCookie)).status).toBe(200);
  });

  it("closes when the firm is no longer active", async () => {
    const setFirmStatus = (status: string) =>
      env.DB_CONTROL.prepare("UPDATE firm SET status = ?2 WHERE id = ?1")
        .bind(firmId, status)
        .run();
    await setFirmStatus("suspended");
    try {
      expect((await get(`/api/portal/v1/firms/${firmId}`, clientCookie)).status).toBe(404);
    } finally {
      await setFirmStatus("active");
    }
  });
});
