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

// Slice 1·1 route surface, driven through the chokepoint over real Miniflare bindings: the
// numbering-scheme surface, matter types, Locations, and the matter shell + lifecycle. Asserts the
// happy paths, that preview never moves a counter, that the Consultations view filters correctly, and
// that a Read-only member is refused a mutation (the chokepoint permission gate).

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

// Mirror a member carrying a named seeded role (the Read-only role grants no slice 1·1 permission).
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
  poolFirmId = (await seedFirm({ name: "Matters Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("matters-owner@example.com", {
    userName: "Matters Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Matters Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("matters-owner@example.com");

  const readOnly = await seedCredentialedUser("matters-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("matters-readonly@example.com");
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function put(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

const YEAR_COUNTER = [
  { kind: "year", digits: 4 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

describe("numbering-scheme routes", () => {
  it("sets, reads, and previews a scheme without moving the counter", async () => {
    const setResponse = await put("/api/v1/numbering-scheme", { segments: YEAR_COUNTER });
    expect(setResponse.status).toBe(200);

    const getResponse = await get("/api/v1/numbering-scheme");
    expect(getResponse.status).toBe(200);
    expect(((await getResponse.json()) as { segments: unknown }).segments).toEqual(YEAR_COUNTER);

    // Preview renders an example but must never touch matter_number_counter.
    const previewResponse = await post("/api/v1/numbering-scheme/preview", {
      segments: YEAR_COUNTER,
      counterValue: 42,
    });
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as { number: string; scopeKey: string };
    expect(preview.number).toMatch(/^\d{4}-0042$/);
    const countersResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM matter_number_counter")
      .all<{ c: number }>();
    const counters = countersResult.results[0];
    expect(counters?.c).toBe(0);
  });

  it("rejects a scheme without exactly one counter (422)", async () => {
    const response = await put("/api/v1/numbering-scheme", {
      segments: [{ kind: "literal", text: "MC" }],
    });
    expect(response.status).toBe(422);
  });
});

describe("matter type and location routes", () => {
  it("creates a matter type and a Location", async () => {
    const typeResponse = await post("/api/v1/matter-types", {
      name: "Personal Injury",
      code: "PI",
    });
    expect(typeResponse.status).toBe(201);
    const typeList = await get("/api/v1/matter-types");
    expect(((await typeList.json()) as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);

    const locationResponse = await post("/api/v1/locations", { name: "Reno", numberCode: "RENO" });
    expect(locationResponse.status).toBe(201);
  });
});

describe("matter lifecycle routes", () => {
  it("creates an open (numbered) matter, a consultation, and filters the lists", async () => {
    const open = await post("/api/v1/matters", {
      title: "Smith v. Jones",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(open.status).toBe(201);
    const openBody = (await open.json()) as { matterId: string; matterNumber: string };
    expect(openBody.matterNumber).toMatch(/^\d{4}-\d{4}$/);

    const consultation = await post("/api/v1/matters", {
      title: "Walk-in consult",
      status: "prospective",
      responsibleMemberId: ownerUserId,
    });
    expect(consultation.status).toBe(201);
    const consultationBody = (await consultation.json()) as {
      matterId: string;
      matterNumber: null;
    };
    expect(consultationBody.matterNumber).toBeNull();

    // The main list is the working caseload — the prospective consultation is excluded.
    const list = await get("/api/v1/matters");
    const listBody = (await list.json()) as { data: { id: string; status: string }[] };
    expect(listBody.data.some((m) => m.id === openBody.matterId)).toBe(true);
    expect(listBody.data.some((m) => m.id === consultationBody.matterId)).toBe(false);

    // The Consultations view holds the prospective.
    const consultations = await get("/api/v1/matters/consultations");
    const consultationsBody = (await consultations.json()) as {
      data: { id: string; isStale: boolean }[];
    };
    expect(consultationsBody.data.some((m) => m.id === consultationBody.matterId)).toBe(true);

    // Open the consultation → draws the next number; close the open matter (empty preconditions).
    const opened = await post(`/api/v1/matters/${consultationBody.matterId}/open`, {});
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { matterNumber: string }).matterNumber).toMatch(
      /^\d{4}-\d{4}$/,
    );

    const closed = await post(`/api/v1/matters/${openBody.matterId}/close`, {});
    expect(closed.status).toBe(200);
  });

  it("returns 422 (not 500) when the draw needs a value the matter lacks", async () => {
    // Set a scheme whose counter scope keys off a required location_code segment.
    const locationScheme = [
      { kind: "location_code" },
      { kind: "literal", text: "-" },
      { kind: "counter", padWidth: 4 },
    ];
    const setResponse = await put("/api/v1/numbering-scheme", { segments: locationScheme });
    expect(setResponse.status).toBe(200);

    // Create-as-open with no location and no firm default → the draw cannot render the number.
    const response = await post("/api/v1/matters", {
      title: "No Location",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { type: string };
    expect(body.type).toContain("validation");

    // Restore the year/counter scheme for the later cases.
    const restore = await put("/api/v1/numbering-scheme", { segments: YEAR_COUNTER });
    expect(restore.status).toBe(200);
  });

  it("replays a create under the same Idempotency-Key (no second matter)", async () => {
    const key = crypto.randomUUID();
    const body = { title: "Idempotent Matter", status: "open", responsibleMemberId: ownerUserId };
    const headers = {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": key,
    };
    const first = await SELF.fetch("https://example.com/api/v1/matters", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { matterId: string }).matterId;
    const replay = await SELF.fetch("https://example.com/api/v1/matters", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(((await replay.json()) as { matterId: string }).matterId).toBe(firstId);
  });
});

describe("permission enforcement", () => {
  it("refuses a Read-only member the create-matter capability (403)", async () => {
    const response = await post(
      "/api/v1/matters",
      { title: "Denied", status: "open", responsibleMemberId: ownerUserId },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
