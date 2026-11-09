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
async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
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
      status: "consultation",
      responsibleMemberId: ownerUserId,
    });
    expect(consultation.status).toBe(201);
    const consultationBody = (await consultation.json()) as {
      matterId: string;
      matterNumber: null;
    };
    expect(consultationBody.matterNumber).toBeNull();

    // The main list is the working caseload — the consultation is excluded.
    const list = await get("/api/v1/matters");
    const listBody = (await list.json()) as { data: { id: string; status: string }[] };
    expect(listBody.data.some((m) => m.id === openBody.matterId)).toBe(true);
    expect(listBody.data.some((m) => m.id === consultationBody.matterId)).toBe(false);

    // The Consultations view holds the consultation.
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

  it("puts an active matter on hold with a reason, reads it back, and releases it", async () => {
    const created = await post("/api/v1/matters", {
      title: "Okonkwo v. Brightwater",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(created.status).toBe(201);
    const { matterId } = (await created.json()) as { matterId: string; matterNumber: string };

    // A hold with nothing said about why is refused at the contract.
    const blank = await post(`/api/v1/matters/${matterId}/hold`, { reason: "   " });
    expect(blank.status).toBe(422);

    const held = await post(`/api/v1/matters/${matterId}/hold`, {
      reason: "Two invoices unpaid; work resumes on payment.",
    });
    expect(held.status).toBe(200);

    const detail = await get(`/api/v1/matters/${matterId}`);
    const detailBody = (await detail.json()) as {
      status: string;
      matterNumber: string | null;
      heldAt: string | null;
      holdReason: string | null;
    };
    expect(detailBody.status).toBe("hold");
    expect(detailBody.matterNumber).toMatch(/^\d{4}-\d{4}$/);
    expect(detailBody.heldAt).not.toBeNull();
    expect(detailBody.holdReason).toBe("Two invoices unpaid; work resumes on payment.");

    // A held matter is a numbered matter and stays on the docket, wearing its status.
    const list = await get("/api/v1/matters");
    const listBody = (await list.json()) as { data: { id: string; status: string }[] };
    expect(listBody.data.find((m) => m.id === matterId)?.status).toBe("hold");

    // A second hold is refused: the matter is not open.
    const again = await post(`/api/v1/matters/${matterId}/hold`, { reason: "Again" });
    expect(again.status).toBe(409);

    const released = await post(`/api/v1/matters/${matterId}/release`, {});
    expect(released.status).toBe(200);
    const after = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      status: string;
      heldAt: string | null;
      holdReason: string | null;
    };
    expect(after).toMatchObject({ status: "open", heldAt: null, holdReason: null });

    // And a release of a matter not on hold is refused.
    const notHeld = await post(`/api/v1/matters/${matterId}/release`, {});
    expect(notHeld.status).toBe(409);
  });

  it("puts a consultation on hold and releases it back to a consultation, tentative number intact", async () => {
    const created = await post("/api/v1/matters", {
      title: "Prospect thinking it over",
      status: "consultation",
      responsibleMemberId: ownerUserId,
    });
    expect(created.status).toBe(201);
    const { matterId, consultationNumber } = (await created.json()) as {
      matterId: string;
      consultationNumber: string;
    };

    const held = await post(`/api/v1/matters/${matterId}/hold`, {
      reason: "The prospect asked for a week to decide.",
    });
    expect(held.status).toBe(200);
    const heldDetail = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      status: string;
      matterNumber: string | null;
      consultationNumber: string | null;
      holdReason: string | null;
    };
    expect(heldDetail).toMatchObject({
      status: "hold",
      matterNumber: null,
      consultationNumber,
      holdReason: "The prospect asked for a week to decide.",
    });

    // The release returns the consultation to a consultation, never to active: nothing opened it.
    const released = await post(`/api/v1/matters/${matterId}/release`, {});
    expect(released.status).toBe(200);
    const after = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      status: string;
      matterNumber: string | null;
      heldAt: string | null;
    };
    expect(after).toMatchObject({ status: "consultation", matterNumber: null, heldAt: null });

    // An intake has nothing to pause and is refused.
    const intake = await post("/api/v1/matters", {
      title: "Walk-in, not yet a consultation",
      status: "intake",
      responsibleMemberId: ownerUserId,
    });
    const intakeId = ((await intake.json()) as { matterId: string }).matterId;
    const refused = await post(`/api/v1/matters/${intakeId}/hold`, { reason: "Waiting" });
    expect(refused.status).toBe(409);
  });

  it("closes a declined consultation without drawing a matter number, and reopens it as one", async () => {
    const created = await post("/api/v1/matters", {
      title: "Declined consultation",
      status: "consultation",
      responsibleMemberId: ownerUserId,
    });
    const { matterId, consultationNumber } = (await created.json()) as {
      matterId: string;
      consultationNumber: string;
    };

    // The readiness read answers for a consultation as it does for an active matter: nothing on its
    // ledgers, so nothing stands in the way.
    const readiness = await get(`/api/v1/matters/${matterId}/close-readiness`);
    expect(readiness.status).toBe(200);
    expect((await readiness.json()) as { closable: boolean }).toMatchObject({ closable: true });

    const closed = await post(`/api/v1/matters/${matterId}/close`, {});
    expect(closed.status).toBe(200);
    const closedDetail = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      status: string;
      matterNumber: string | null;
      consultationNumber: string | null;
      closedAt: string | null;
    };
    expect(closedDetail).toMatchObject({
      status: "closed",
      matterNumber: null,
      consultationNumber,
    });
    expect(closedDetail.closedAt).not.toBeNull();

    const reopened = await post(`/api/v1/matters/${matterId}/reopen`, {});
    expect(reopened.status).toBe(200);
    expect(
      (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
        status: string;
        matterNumber: string | null;
      },
    ).toMatchObject({ status: "consultation", matterNumber: null });
  });

  it("writes the client's party link in the same batch as the matter, for both starting statuses", async () => {
    const person = await post("/api/v1/directory/persons", {
      given: "Eleanor",
      family: "Pemberton",
    });
    expect(person.status).toBe(201);
    const { id: clientEntityId } = (await person.json()) as { id: string };

    for (const status of ["open", "consultation"] as const) {
      const created = await post("/api/v1/matters", {
        title: `Pemberton ${status}`,
        status,
        responsibleMemberId: ownerUserId,
        clientDisplayName: "Eleanor Pemberton",
        clientEntityId,
      });
      expect(created.status).toBe(201);
      const { matterId } = (await created.json()) as { matterId: string };

      const detail = await get(`/api/v1/matters/${matterId}`);
      expect(detail.status).toBe(200);
      expect(((await detail.json()) as { clientEntityId: string | null }).clientEntityId).toBe(
        clientEntityId,
      );

      const parties = await get(`/api/v1/directory/matter-parties?matterId=${matterId}`);
      expect(parties.status).toBe(200);
      const { parties: rows } = (await parties.json()) as {
        parties: { entityId: string; role: string }[];
      };
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityId: clientEntityId, role: "client" });
    }
  });

  it("refuses a client handle that is not a directory entity (422)", async () => {
    const created = await post("/api/v1/matters", {
      title: "Nobody's matter",
      status: "open",
      responsibleMemberId: ownerUserId,
      clientEntityId: "matter_notAnEntity",
    });
    expect(created.status).toBe(422);
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

describe("manual renumber conflict", () => {
  // End-to-end proof that a NON-idempotency UNIQUE violation (matter.matter_number) is detected
  // through the real FIRM_DATABASE Durable Object. The DO catches the violation, the proxy
  // reconstructs "UNIQUE constraint failed: matter.matter_number", isMatterNumberConflict matches it,
  // and the service maps it to matter-number-taken → 409. Were detection still tied to one hardcoded
  // column (the pre-fix behaviour), this conflict would cross RPC as a raw fault and surface as 500.
  it("returns 409 when renumbering a matter to a number already in use", async () => {
    const first = await post("/api/v1/matters", {
      title: "Renumber Source",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { matterId: string }).matterId;

    const second = await post("/api/v1/matters", {
      title: "Renumber Target",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(second.status).toBe(201);
    const secondNumber = ((await second.json()) as { matterNumber: string }).matterNumber;

    // Renumber the first matter onto the second's number → the matter_number UNIQUE index aborts.
    const conflict = await post(`/api/v1/matters/${firstId}/renumber`, {
      matterNumber: secondNumber,
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { type: string }).type).toContain("conflict");
  });
});

describe("the matter detail read", () => {
  it("answers with the type, Location and responsible member by NAME, not by identifier", async () => {
    const type = await post("/api/v1/matter-types", { name: "Estate Planning", code: "EP" });
    expect(type.status).toBe(201);
    const typeId = ((await type.json()) as { id: string }).id;

    const location = await post("/api/v1/locations", { name: "Las Vegas", numberCode: "LV" });
    expect(location.status).toBe(201);
    const locationId = ((await location.json()) as { id: string }).id;

    const created = await post("/api/v1/matters", {
      title: "Estate of Hollis",
      status: "open",
      responsibleMemberId: ownerUserId,
      matterTypeId: typeId,
      locationId,
    });
    expect(created.status).toBe(201);
    const matterId = ((await created.json()) as { matterId: string }).matterId;

    const detail = await get(`/api/v1/matters/${matterId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      matterTypeName: string | null;
      locationName: string | null;
      responsibleMemberName: string | null;
      openedAt: string | null;
      createdAt: string;
      eBilling: boolean;
    };

    // The screen cannot print a matterType_ handle at a person, so the read resolves the names.
    expect(body.matterTypeName).toBe("Estate Planning");
    expect(body.locationName).toBe("Las Vegas");
    expect(body.responsibleMemberName).not.toBeNull();
    // An open matter carries the instant it opened, and every matter its creation instant.
    expect(body.openedAt).not.toBeNull();
    expect(body.createdAt).not.toBe("");
    expect(typeof body.eBilling).toBe("boolean");
  });

  it("reports an unset type and Location as absent rather than inventing one", async () => {
    const created = await post("/api/v1/matters", {
      title: "Bare Matter",
      status: "consultation",
      responsibleMemberId: ownerUserId,
    });
    expect(created.status).toBe(201);
    const matterId = ((await created.json()) as { matterId: string }).matterId;

    const detail = await get(`/api/v1/matters/${matterId}`);
    const body = (await detail.json()) as {
      matterTypeName: string | null;
      locationName: string | null;
      openedAt: string | null;
    };
    expect(body.matterTypeName).toBeNull();
    expect(body.locationName).toBeNull();
    // A consultation has not opened, and says so.
    expect(body.openedAt).toBeNull();
  });
});

describe("the matter's paper file", () => {
  it("is kept at an office of its own, which is not the office the matter is run out of", async () => {
    const runOutOf = await post("/api/v1/locations", { name: "Carson City", numberCode: "CC" });
    const store = await post("/api/v1/locations", { name: "Sparks Records Store" });
    const runOutOfId = ((await runOutOf.json()) as { id: string }).id;
    const storeId = ((await store.json()) as { id: string }).id;

    const created = await post("/api/v1/matters", {
      title: "Boxed Elsewhere",
      status: "open",
      responsibleMemberId: ownerUserId,
      locationId: runOutOfId,
    });
    expect(created.status).toBe(201);
    const matterId = ((await created.json()) as { matterId: string }).matterId;

    // Nobody has said where the folder is, so the read says nothing rather than assuming it is
    // wherever the matter is run out of. That assumption is the whole reason the two are separate.
    const before = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      locationId: string | null;
      physicalFileLocationId: string | null;
      physicalFileLocationName: string | null;
    };
    expect(before.locationId).toBe(runOutOfId);
    expect(before.physicalFileLocationId).toBeNull();
    expect(before.physicalFileLocationName).toBeNull();

    expect(
      (await patch(`/api/v1/matters/${matterId}`, { physicalFileLocationId: storeId })).status,
    ).toBe(200);

    const after = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      locationId: string | null;
      locationName: string | null;
      physicalFileLocationId: string | null;
      physicalFileLocationName: string | null;
    };
    expect(after.physicalFileLocationId).toBe(storeId);
    expect(after.physicalFileLocationName).toBe("Sparks Records Store");
    // Recording where the file is kept moves nothing about which office runs the matter.
    expect(after.locationId).toBe(runOutOfId);
    expect(after.locationName).toBe("Carson City");
  });

  it("can be un-recorded, because not knowing where a file is is a real answer", async () => {
    const store = await post("/api/v1/locations", { name: "Reno Vault" });
    const storeId = ((await store.json()) as { id: string }).id;
    const created = await post("/api/v1/matters", {
      title: "File Gone Walkabout",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    const matterId = ((await created.json()) as { matterId: string }).matterId;

    await patch(`/api/v1/matters/${matterId}`, { physicalFileLocationId: storeId });
    expect(
      (await patch(`/api/v1/matters/${matterId}`, { physicalFileLocationId: null })).status,
    ).toBe(200);

    const detail = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      physicalFileLocationId: string | null;
    };
    expect(detail.physicalFileLocationId).toBeNull();
  });

  it("survives a patch that does not mention it", async () => {
    const store = await post("/api/v1/locations", { name: "Elko Annex" });
    const storeId = ((await store.json()) as { id: string }).id;
    const created = await post("/api/v1/matters", {
      title: "Retitled Later",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    const matterId = ((await created.json()) as { matterId: string }).matterId;

    await patch(`/api/v1/matters/${matterId}`, { physicalFileLocationId: storeId });
    await patch(`/api/v1/matters/${matterId}`, { title: "Retitled" });

    const detail = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      title: string;
      physicalFileLocationId: string | null;
    };
    expect(detail.title).toBe("Retitled");
    expect(detail.physicalFileLocationId).toBe(storeId);
  });
});

describe("the date the matter's paper file may be destroyed", () => {
  async function newMatter(title: string): Promise<string> {
    const created = await post("/api/v1/matters", {
      title,
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { matterId: string }).matterId;
  }

  async function detailDate(matterId: string): Promise<string | null> {
    const detail = (await (await get(`/api/v1/matters/${matterId}`)).json()) as {
      fileDestructionDate: string | null;
    };
    return detail.fileDestructionDate;
  }

  async function setMinimum(years: number): Promise<void> {
    const response = await patch("/api/v1/matters/settings", { fileRetentionMinimumYears: years });
    expect(response.status).toBe(200);
  }

  // The floor for a close made today, computed the way the service computes it.
  function yearsFromToday(years: number): string {
    const today = new Date();
    return `${String(today.getUTCFullYear() + years)}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  }

  it("reads the firm's minimum, which is none until the firm sets one, and only Owner/Admin sets it", async () => {
    await setMinimum(0);
    const read = (await (await get("/api/v1/matters/settings", readOnlyCookie)).json()) as {
      fileRetentionMinimumYears: number;
    };
    expect(read.fileRetentionMinimumYears).toBe(0);
    expect(
      (await patch("/api/v1/matters/settings", { fileRetentionMinimumYears: 3 }, readOnlyCookie))
        .status,
    ).toBe(403);
    expect(
      (await patch("/api/v1/matters/settings", { fileRetentionMinimumYears: 101 })).status,
    ).toBe(422);
  });

  it("is stated at the close, read back on the matter, and falls due on the firm calendar", async () => {
    await setMinimum(7);
    const matterId = await newMatter("Retention Recorded");
    const destroyOn = yearsFromToday(8);
    const closed = await post(`/api/v1/matters/${matterId}/close`, { fileDestroyOn: destroyOn });
    expect(closed.status).toBe(200);
    expect(await detailDate(matterId)).toBe(destroyOn);

    const month = destroyOn.slice(0, 7);
    const calendar = await get(
      `/api/v1/calendar/events?from=${month}-01&to=${month}-28&scope=matter&kind=matterFileDestruction`,
    );
    expect(calendar.status).toBe(200);
    const page = (await calendar.json()) as {
      data: { sourceKey: string; kind: string; matterId: string | null; sortKey: string }[];
    };
    if (Number(destroyOn.slice(8, 10)) <= 28) {
      expect(page.data).toContainEqual(
        expect.objectContaining({
          sourceKey: "matterFileDestruction",
          kind: "fileDestruction",
          matterId,
          sortKey: destroyOn,
        }),
      );
    }
    await setMinimum(0);
  });

  it("refuses a close whose date is under the minimum, and a later write on an open matter", async () => {
    await setMinimum(7);
    const matterId = await newMatter("Retention Too Soon");
    const refused = await post(`/api/v1/matters/${matterId}/close`, {
      fileDestroyOn: yearsFromToday(6),
    });
    expect(refused.status).toBe(422);
    const detail = (await (await get(`/api/v1/matters/${matterId}`)).json()) as { status: string };
    expect(detail.status).toBe("open");
    // The date is set when the matter closes, so an open matter takes none from the status window.
    expect(
      (await put(`/api/v1/matters/${matterId}/file-destruction-date`, { destroyOn: "2040-01-01" }))
        .status,
    ).toBe(422);
    await setMinimum(0);
  });

  it("closes with none; a date can then be added, refused and cleared", async () => {
    await setMinimum(0);
    const matterId = await newMatter("Retention Later");
    expect((await post(`/api/v1/matters/${matterId}/close`, { fileDestroyOn: null })).status).toBe(
      200,
    );
    expect(await detailDate(matterId)).toBeNull();

    const recorded = await put(`/api/v1/matters/${matterId}/file-destruction-date`, {
      destroyOn: "2034-02-01",
    });
    expect(recorded.status).toBe(200);
    expect(await recorded.json()).toMatchObject({
      matterId,
      destroyOn: "2034-02-01",
      recordedByUserId: ownerUserId,
    });
    expect(await detailDate(matterId)).toBe("2034-02-01");

    // A day that does not exist, an unknown matter, and a member without matters:edit.
    expect(
      (await put(`/api/v1/matters/${matterId}/file-destruction-date`, { destroyOn: "2033-02-30" }))
        .status,
    ).toBe(422);
    expect(
      (
        await put(`/api/v1/matters/${newIdentifier("matter")}/file-destruction-date`, {
          destroyOn: "2033-11-09",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await put(
          `/api/v1/matters/${matterId}/file-destruction-date`,
          { destroyOn: "2033-11-09" },
          readOnlyCookie,
        )
      ).status,
    ).toBe(403);
    expect(await detailDate(matterId)).toBe("2034-02-01");

    expect(
      (await put(`/api/v1/matters/${matterId}/file-destruction-date`, { destroyOn: null })).status,
    ).toBe(200);
    expect(await detailDate(matterId)).toBeNull();
    // That a reopen clears the date is asserted against the service, in
    // packages/matters/test/matter-file-retention.test.ts: this file already spends the per-minute
    // rate limit close to its edge.
  });
});
