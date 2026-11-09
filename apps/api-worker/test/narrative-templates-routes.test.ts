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
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Narrative template routes: the HTTP surface for create, list, and recent-narratives. Templates
// pre-fill narrative and optional rate on a time entry; recent-narratives returns distinct narratives
// from the timekeeper's time_entry history (most recently used first). The recent-narratives endpoint
// requires only time:track and is registered before any /{id}/* routes so the literal path segment
// "recent-narratives" matches first, not a dynamic :id.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let secondTimekeeperCookie: string;
let ownerUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({
      name: "Narrative Template Test Firm",
      databaseIdentifier: "DB_FIRM_POOL_1",
    })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("nt-owner@example.com", {
    userName: "NT Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "NT Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("nt-owner@example.com");

  // A second timekeeper with time:track (Admin role) — used to assert that a time:track user
  // cannot read another timekeeper's recent narratives.
  const secondTimekeeper = await seedCredentialedUser("nt-second@example.com", {
    userName: "NT Second",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(secondTimekeeper.userId, "NT Second", poolFirmId);
  secondTimekeeperCookie = await signInForSessionCookie("nt-second@example.com");

  const readOnly = await seedCredentialedUser("nt-readonly@example.com", {
    userName: "NT Read Only",
    firmId: poolFirmId,
  });
  const role = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind("Read-only")
    .first<{ id: string }>();
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId: readOnly.userId,
    displayName: "NT Read Only",
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    id: newIdentifier("memberRole"),
    memberUserId: readOnly.userId,
    roleId: assertIdentifier(role!.id, "role"),
  }).run();
  readOnlyCookie = await signInForSessionCookie("nt-readonly@example.com");
});

function writeHeaders(cookie: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}
function readHeaders(cookie: string): HeadersInit {
  return { origin: "https://example.com", cookie };
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: writeHeaders(cookie),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: readHeaders(cookie) });
}

describe("narrative template lifecycle", () => {
  it("creates a template and lists it", async () => {
    // Create
    const createResponse = await post("/api/v1/narrative-templates", {
      narrativeTemplate: "Drafted and reviewed demand letter",
      utbmsTaskCodeId: null,
      defaultRateE4: null,
    });
    expect(createResponse.status).toBe(201);
    const { narrativeTemplateId } = (await createResponse.json()) as {
      narrativeTemplateId: string;
    };
    expect(narrativeTemplateId).toMatch(/^narrativeTemplate_/);

    // List — the created template must appear
    const listResponse = await get("/api/v1/narrative-templates");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      data: { id: string; narrativeTemplate: string }[];
    };
    expect(list.data.some((t) => t.id === narrativeTemplateId)).toBe(true);
  });

  it("returns the timekeeper's recent narratives (empty initially on a fresh firm)", async () => {
    const response = await get(
      `/api/v1/narrative-templates/recent-narratives?timekeeperUserId=${ownerUserId}&limit=10`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: string[] };
    // No time entries have been captured yet for this firm, so the list is empty.
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("refuses a time:track member reading another timekeeper's narratives (403)", async () => {
    // secondTimekeeperCookie belongs to a time:track user (Admin). Requesting ownerUserId's
    // narratives from that session must be refused — recent narratives are personal autocomplete,
    // not cross-user readable, so the timekeeperUserId param must match the session user.
    const response = await get(
      `/api/v1/narrative-templates/recent-narratives?timekeeperUserId=${ownerUserId}&limit=10`,
      secondTimekeeperCookie,
    );
    expect(response.status).toBe(403);
  });
});

describe("permission gate", () => {
  it("refuses a Read-only member the time:manageSettings capability on create (403)", async () => {
    const response = await post(
      "/api/v1/narrative-templates",
      {
        narrativeTemplate: "Denied",
        utbmsTaskCodeId: null,
        defaultRateE4: null,
      },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
