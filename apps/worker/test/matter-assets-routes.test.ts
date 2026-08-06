import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The matter asset register's route surface, driven through the chokepoint over real Miniflare
// bindings: a firm opens an estate matter, bulk-adds a house and two accounts, attaches a deed,
// records a date-of-death appraisal and a later broker figure, corrects a fat-fingered entry, and
// reads the house's value as of the date of death.
//
// This block seeds its OWN firm. The chokepoint's rate-limit key is `firm:<firmId>`, so a suite that
// makes this many requests would otherwise spend another block's window and start collecting 429s.

let firmId: FirmId;
let ownerCookie: string;
let registerOnlyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerUserId: UserId;
let matterId: string;
let secondMatterId: string;

const clock = { now: () => new Date().toISOString() };

// A member holding matterAssets:read and matterAssets:manage but NOT the decrypt permission — which
// is the whole point of the protected identifier: reading the register and opening a full account
// number are different grants, and the second is not implied by the first.
async function mirrorMemberWithRegisterGrants(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: clock.now() }).run();
  for (const permission of ["matterAssets:read", "matterAssets:manage"]) {
    await database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
      )
      .bind(newIdentifier("grant"), userId, permission, clock.now())
      .run();
  }
}

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

async function patch(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, crypto.randomUUID()),
    body: JSON.stringify(body),
  });
}

async function remove(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(cookie, crypto.randomUUID()),
  });
}

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function createMatter(title: string): Promise<string> {
  const response = await post("/api/v1/matters", {
    title,
    status: "prospective",
    responsibleMemberId: ownerUserId,
  });
  expect(response.status).toBe(201);
  const { matterId: id } = (await response.json()) as { matterId: string };
  return id;
}

// A stored file, seeded directly. NO BYTES ever reach an asset route: upload is the File Manager's
// presigned-upload and quarantine chokepoint, and the asset surface only links the handle it
// produces — so this test seeds the handle rather than routing bytes through a path that does not
// exist.
async function seedFile(fileId: string, matterFileBelongsTo: string, name: string): Promise<void> {
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
        "VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterFileBelongsTo, name, clock.now())
    .run();
}

async function createAsset(body: Record<string, unknown>, matter = matterId): Promise<string> {
  const response = await post(`/api/v1/matters/${matter}/assets`, body);
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Matter Assets Test Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("assets-owner@example.com", {
    userName: "Assets Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Assets Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("assets-owner@example.com");

  const registerOnly = await seedCredentialedUser("assets-register@example.com", {
    userName: "Assets Register Clerk",
    firmId,
  });
  await mirrorMemberWithRegisterGrants(firmDatabase, registerOnly.userId, "Assets Register Clerk");
  registerOnlyCookie = await signInForSessionCookie("assets-register@example.com");

  matterId = await createMatter("Estate of Alvarez");
  secondMatterId = await createMatter("Brown divorce");
});

describe("logging what an estate owns", () => {
  it("bulk-adds a house and two accounts in one call, and lists them back", async () => {
    const response = await post(`/api/v1/matters/${matterId}/assets/batch`, {
      assets: [
        {
          assetClass: "realProperty",
          description: "The house on Elm Street",
          realProperty: { street: "114 Elm Street", city: "Reno", region: "NV" },
        },
        { assetClass: "financialAccount", description: "Checking at First National" },
        { assetClass: "financialAccount", description: "Brokerage at Northgate" },
      ],
    });
    expect(response.status).toBe(201);
    const { ids } = (await response.json()) as { ids: string[] };
    expect(ids).toHaveLength(3);

    const listed = await get(`/api/v1/matters/${matterId}/assets?assetClass=financialAccount`);
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as { data: { description: string }[] };
    expect(page.data.map((row) => row.description).sort()).toEqual([
      "Brokerage at Northgate",
      "Checking at First National",
    ]);
  });

  // A retried batch must not put the estate's items on the register twice.
  it("records each asset exactly once when the batch is retried", async () => {
    const key = crypto.randomUUID();
    const body = {
      assets: [{ assetClass: "other", description: "Contents of the garage, not yet itemized" }],
    };
    const first = await post(
      `/api/v1/matters/${secondMatterId}/assets/batch`,
      body,
      ownerCookie,
      key,
    );
    expect(first.status).toBe(201);
    const retried = await post(
      `/api/v1/matters/${secondMatterId}/assets/batch`,
      body,
      ownerCookie,
      key,
    );
    expect(retried.status).toBe(201);
    expect(await retried.json()).toEqual(await first.json());

    const listed = await get(`/api/v1/matters/${secondMatterId}/assets`);
    const page = (await listed.json()) as { data: unknown[] };
    expect(page.data).toHaveLength(1);
  });

  it("refuses a class whose structured attributes have not shipped yet", async () => {
    const response = await post(`/api/v1/matters/${matterId}/assets`, {
      assetClass: "firearm",
      description: "Shotgun in the safe",
    });
    expect(response.status).toBe(422);
  });

  it("refuses a patch that names the class", async () => {
    const assetId = await createAsset({ assetClass: "other", description: "A thing" });
    const response = await patch(`/api/v1/matter-assets/${assetId}`, {
      assetClass: "realProperty",
    });
    expect(response.status).toBe(409);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("matter-asset-class-frozen");
  });
});

describe("what it was worth, and when", () => {
  it("resolves the date-of-death figure, and nothing at all before the first one", async () => {
    const assetId = await createAsset({
      assetClass: "realProperty",
      description: "The house on Oak Street",
    });
    const appraisal = await post(`/api/v1/matter-assets/${assetId}/valuations`, {
      asOfDate: "2026-03-14",
      amountMinor: 40000000,
      currency: "USD",
      basis: "appraisal",
    });
    expect(appraisal.status).toBe(201);
    await post(`/api/v1/matter-assets/${assetId}/valuations`, {
      asOfDate: "2026-07-01",
      amountMinor: 42500000,
      currency: "USD",
      basis: "broker",
    });

    const atDeath = await get(`/api/v1/matter-assets/${assetId}?asOf=2026-03-14`);
    const atDeathBody = (await atDeath.json()) as {
      valueAsOf: { amountMinor: number; asOfDate: string; basis: string } | null;
    };
    // The answer travels with its own date and its footing — never a bare number.
    expect(atDeathBody.valueAsOf).toMatchObject({
      amountMinor: 40000000,
      asOfDate: "2026-03-14",
      basis: "appraisal",
    });

    const today = await get(`/api/v1/matter-assets/${assetId}?asOf=2026-08-06`);
    const todayBody = (await today.json()) as { valueAsOf: { amountMinor: number } | null };
    expect(todayBody.valueAsOf?.amountMinor).toBe(42500000);

    // Before the first figure: NOTHING, never the earliest value. An asset acquired after the date
    // of death is not in the estate at the date of death.
    const before = await get(`/api/v1/matter-assets/${assetId}?asOf=2026-01-01`);
    const beforeBody = (await before.json()) as { valueAsOf: unknown };
    expect(beforeBody.valueAsOf).toBeNull();
  });

  it("supersedes a corrected figure with its correction and keeps both on the record", async () => {
    const assetId = await createAsset({
      assetClass: "realProperty",
      description: "The house on Pine Street",
    });
    const wrong = await post(`/api/v1/matter-assets/${assetId}/valuations`, {
      asOfDate: "2026-03-14",
      amountMinor: 4000000000,
      currency: "USD",
      basis: "appraisal",
    });
    const { id: wrongId } = (await wrong.json()) as { id: string };
    const correction = await post(`/api/v1/matter-assets/${assetId}/valuations`, {
      asOfDate: "2026-03-14",
      amountMinor: 40000000,
      currency: "USD",
      basis: "appraisal",
      sourceNote: "transposed digits on the original entry",
      correctsValuationId: wrongId,
    });
    expect(correction.status).toBe(201);

    const resolved = await get(`/api/v1/matter-assets/${assetId}?asOf=2026-06-01`);
    const body = (await resolved.json()) as { valueAsOf: { amountMinor: number } | null };
    expect(body.valueAsOf?.amountMinor).toBe(40000000);

    const history = await get(`/api/v1/matter-assets/${assetId}/valuations`);
    const historyBody = (await history.json()) as {
      data: { correctsValuationId: string | null }[];
    };
    expect(historyBody.data).toHaveLength(2);
    expect(historyBody.data.some((row) => row.correctsValuationId === wrongId)).toBe(true);
  });

  // No route edits or deletes a recorded value, which is the API expression of the append-only
  // history: the shape a caller would reach for does not exist.
  it("offers no route that edits or deletes a recorded value", async () => {
    const assetId = await createAsset({ assetClass: "other", description: "A thing with a value" });
    const appended = await post(`/api/v1/matter-assets/${assetId}/valuations`, {
      asOfDate: "2026-03-14",
      amountMinor: 100,
      currency: "USD",
      basis: "clientEstimate",
    });
    const { id: valuationId } = (await appended.json()) as { id: string };
    const edited = await patch(`/api/v1/matter-assets/${assetId}/valuations/${valuationId}`, {
      amountMinor: 1,
    });
    expect(edited.status).toBe(404);
    const deleted = await remove(`/api/v1/matter-assets/${assetId}/valuations/${valuationId}`);
    expect(deleted.status).toBe(404);
  });
});

describe("documents stay ordinary matter documents", () => {
  it("links a deed both ways and unlinks without touching the file", async () => {
    const assetId = await createAsset({
      assetClass: "realProperty",
      description: "The house on Maple Street",
    });
    const fileId = newIdentifier("file");
    await seedFile(fileId, matterId, "Deed - Maple Street.pdf");

    const linked = await post(`/api/v1/matter-assets/${assetId}/documents`, {
      fileId,
      kind: "deed",
    });
    expect(linked.status).toBe(201);
    const { id: linkId } = (await linked.json()) as { id: string };

    const detail = await get(`/api/v1/matter-assets/${assetId}`);
    const body = (await detail.json()) as { documents: { fileId: string; kind: string }[] };
    expect(body.documents).toEqual([expect.objectContaining({ fileId, kind: "deed" })]);

    const unlinked = await remove(`/api/v1/matter-assets/${assetId}/documents/${linkId}`);
    expect(unlinked.status).toBe(200);

    const after = await get(`/api/v1/matter-assets/${assetId}`);
    const afterBody = (await after.json()) as { documents: unknown[] };
    expect(afterBody.documents).toHaveLength(0);
    // The file itself is untouched: unlinking is a filing decision reversed, not a deletion.
    const { results } = await firmDatabase
      .prepare("SELECT id FROM file WHERE id = ?1 AND deleted_at IS NULL")
      .bind(fileId)
      .all<{ id: string }>();
    expect(results).toHaveLength(1);
  });

  it("refuses a file filed under another matter", async () => {
    const assetId = await createAsset({ assetClass: "other", description: "A thing" });
    const strayFileId = newIdentifier("file");
    await seedFile(strayFileId, secondMatterId, "Deed - Brown.pdf");
    const response = await post(`/api/v1/matter-assets/${assetId}/documents`, {
      fileId: strayFileId,
      kind: "deed",
    });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("matter-asset-document-matter-mismatch");
  });
});

describe("account numbers are sealed, and credentials are refused", () => {
  it("shows only the last four without the decrypt permission, and audits the full read", async () => {
    const assetId = await createAsset({
      assetClass: "financialAccount",
      description: "Brokerage at Northgate",
    });
    const recorded = await post(
      `/api/v1/matter-assets/${assetId}/identifiers`,
      { kind: "accountNumber", value: "000123454417" },
      registerOnlyCookie,
    );
    expect(recorded.status).toBe(201);
    const { id: identifierId } = (await recorded.json()) as { id: string };

    // The ordinary read: the suffix and nothing else, on a shape with no field a full number could
    // ride on.
    const detail = await get(`/api/v1/matter-assets/${assetId}`, registerOnlyCookie);
    const body = (await detail.json()) as { identifiers: { displaySuffix: string }[] };
    expect(body.identifiers).toEqual([expect.objectContaining({ displaySuffix: "4417" })]);
    expect(JSON.stringify(body)).not.toContain("000123454417");

    // Without the decrypt permission the full read is a NAMED refusal — never a blank, which would
    // read as "there is no account number".
    const refused = await get(
      `/api/v1/matter-assets/${assetId}/identifiers/${identifierId}/value`,
      registerOnlyCookie,
    );
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain("000123454417");

    const auditsBefore = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = 'protected.decrypt'")
      .all<{ total: number }>();

    // The owner holds directory:viewSensitiveIdentifiers by role seed, so the one full-value path
    // opens — and writes its audit row before any plaintext exists.
    const opened = await get(`/api/v1/matter-assets/${assetId}/identifiers/${identifierId}/value`);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ value: "000123454417" });

    const auditsAfter = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = 'protected.decrypt'")
      .all<{ total: number }>();
    expect((auditsAfter.results[0]?.total ?? 0) - (auditsBefore.results[0]?.total ?? 0)).toBe(1);
  });

  it("refuses a seed phrase by name and stores nothing", async () => {
    const assetId = await createAsset({
      assetClass: "other",
      description: "A self-custodied wallet",
    });
    const response = await post(`/api/v1/matter-assets/${assetId}/identifiers`, {
      kind: "seedPhrase",
      value: "correct horse battery staple",
    });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string; detail: string };
    expect(problem.type).toContain("matter-asset-credential-storage-refused");
    // The refusal explains where such a secret belongs rather than shrugging.
    expect(problem.detail).toContain("custody register");

    const detail = await get(`/api/v1/matter-assets/${assetId}`);
    const body = (await detail.json()) as { identifiers: unknown[] };
    expect(body.identifiers).toHaveLength(0);
  });
});

describe("the type catalog and the class registry", () => {
  it("serves the seeded catalog under each class and refuses a mismatched type", async () => {
    const catalog = await get("/api/v1/matter-asset-types?assetClass=financialAccount");
    expect(catalog.status).toBe(200);
    const body = (await catalog.json()) as { data: { id: string; name: string }[] };
    const brokerage = body.data.find((row) => row.name === "Brokerage account");
    expect(brokerage).toBeDefined();

    const mismatched = await post(`/api/v1/matters/${matterId}/assets`, {
      assetClass: "realProperty",
      description: "The house on Cedar Street",
      assetTypeId: brokerage?.id,
    });
    expect(mismatched.status).toBe(422);
    const problem = (await mismatched.json()) as { type: string };
    expect(problem.type).toContain("matter-asset-type-class-mismatch");
  });

  it("returns the firearm handling notice and no other", async () => {
    const response = await get("/api/v1/matter-asset-classes");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { key: string; handlingNote: string | null }[];
    };
    const withNotes = body.data.filter((row) => row.handlingNote !== null);
    expect(withNotes.map((row) => row.key)).toEqual(["firearm"]);
    expect(withNotes[0]?.handlingNote).not.toMatch(/\d/);
  });
});

describe("interests", () => {
  it("records a fractional share and ends it by writing a date", async () => {
    const assetId = await createAsset({
      assetClass: "realProperty",
      description: "The house on Birch Street",
    });
    const added = await post(`/api/v1/matter-assets/${assetId}/interests`, {
      entityId: "directoryPerson_alvarezDaughter0000",
      interestRole: "Joint owner",
      shareNumerator: 1,
      shareDenominator: 3,
      effectiveFrom: "2026-03-14",
    });
    expect(added.status).toBe(201);
    const { id: interestId } = (await added.json()) as { id: string };

    const ended = await post(`/api/v1/matter-assets/${assetId}/interests/${interestId}/end`, {
      effectiveTo: "2026-08-01",
    });
    expect(ended.status).toBe(200);

    const detail = await get(`/api/v1/matter-assets/${assetId}`);
    const body = (await detail.json()) as {
      interests: { effectiveTo: string | null; shareDenominator: number }[];
    };
    // Ended, never removed: who held what and until when is the record.
    expect(body.interests).toEqual([
      expect.objectContaining({ effectiveTo: "2026-08-01", shareDenominator: 3 }),
    ]);
  });
});

describe("the chokepoint contract", () => {
  it("refuses a caller with no session", async () => {
    const response = await SELF.fetch(`https://example.com/api/v1/matters/${matterId}/assets`, {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });

  it("requires an idempotency key on a recording route", async () => {
    const response = await SELF.fetch(`https://example.com/api/v1/matters/${matterId}/assets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
      },
      body: JSON.stringify({ assetClass: "other", description: "A thing" }),
    });
    expect(response.status).toBe(400);
  });
});
