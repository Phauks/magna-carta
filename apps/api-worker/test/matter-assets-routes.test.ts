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
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import type { ProblemBody } from "../src/http/contracts/problem.ts";

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
    status: "consultation",
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

  it("records a firearm, and returns the class's standing handling notice with it", async () => {
    const assetId = await createAsset({
      assetClass: "firearm",
      description: "Shotgun in the safe",
    });
    const detail = (await (await get(`/api/v1/matter-assets/${assetId}`)).json()) as {
      classHandlingNote: string | null;
    };
    // Rendered to a person and branched on by nothing: the register records what is held and
    // determines nothing about who may receive it.
    expect(detail.classHandlingNote).toContain("does not determine who may receive it");
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
      nextCursor: string | null;
    };
    expect(historyBody.data).toHaveLength(2);
    expect(historyBody.data.some((row) => row.correctsValuationId === wrongId)).toBe(true);
    // The paged envelope, on a history short enough to fit one page: a caller reads `nextCursor`
    // to know it has the whole record, and null is the only answer that says so.
    expect(historyBody.nextCursor).toBeNull();
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

describe("every class, end to end", () => {
  it("records a vehicle, a firearm, a policy, a receivable and a digital asset with their own attributes", async () => {
    const scheduleMatter = await createMatter("Estate of Okonkwo");
    const created = await post(`/api/v1/matters/${scheduleMatter}/assets/batch`, {
      assets: [
        {
          assetClass: "vehicle",
          description: "2019 pickup",
          vehicle: {
            make: "Ford",
            model: "F-150",
            modelYear: 2019,
            vehicleIdentificationNumber: "1FTEW1E50KFA12345",
            plateNumber: "NV 442 KLM",
          },
        },
        {
          assetClass: "firearm",
          description: "Shotgun in the study",
          firearm: {
            make: "Beretta",
            model: "686",
            caliberOrGauge: "12 gauge",
            serialNumber: "A1234567",
          },
        },
        {
          assetClass: "insurancePolicy",
          description: "Whole life policy",
          insurancePolicy: {
            carrierName: "Riverside Mutual",
            faceAmountMinor: 250_000_00,
            faceCurrency: "USD",
          },
        },
        {
          assetClass: "receivable",
          description: "Loan to the nephew",
          receivable: { principalAmountMinor: 15_000_00, principalCurrency: "USD", secured: false },
        },
        {
          assetClass: "digitalAsset",
          description: "Exchange account",
          digitalAsset: { platformName: "Riverside Exchange", custodyModel: "custodial" },
        },
      ],
    });
    expect(created.status).toBe(201);
    const { ids } = (await created.json()) as { ids: string[] };
    expect(ids).toHaveLength(5);

    const vehicle = (await (await get(`/api/v1/matter-assets/${ids[0]}`)).json()) as {
      vehicle: { vehicleIdentificationNumber: string; modelYear: number } | null;
      firearm: unknown;
    };
    // A public-record identifier, plaintext and readable — searching by it is the point.
    expect(vehicle.vehicle?.vehicleIdentificationNumber).toBe("1FTEW1E50KFA12345");
    expect(vehicle.vehicle?.modelYear).toBe(2019);
    // A class carries ONE attribute row, and it is the row its class names.
    expect(vehicle.firearm).toBeNull();

    const policy = (await (await get(`/api/v1/matter-assets/${ids[2]}`)).json()) as {
      insurancePolicy: { faceAmountMinor: number } | null;
      valueAsOf: unknown;
    };
    // The FACE AMOUNT is a term of the policy and is not a valuation: with no valuation recorded the
    // asset is unvalued, and a term-life policy does not read as a liquid asset worth its benefit.
    expect(policy.insurancePolicy?.faceAmountMinor).toBe(250_000_00);
    expect(policy.valueAsOf ?? null).toBeNull();
  });

  it("refuses one class's attributes on another class's asset rather than dropping them", async () => {
    const response = await post(`/api/v1/matters/${matterId}/assets`, {
      assetClass: "firearm",
      description: "Shotgun",
      vehicle: { vehicleIdentificationNumber: "1FTEW1E50KFA12345" },
    });
    expect(response.status).toBe(422);
    expect((await readJson<ProblemBody>(response)).type).toContain(
      "matter-asset-type-class-mismatch",
    );
  });
});

describe("the estate schedule", () => {
  it("groups, subtotals, nets equity, and states the unvalued count as of the date asked for", async () => {
    const estate = await createMatter("Estate of Marchetti");
    const houseId = await createAsset(
      {
        assetClass: "realProperty",
        description: "14 Cavendish Row",
        estateTreatment: "probateEstate",
        valuation: {
          asOfDate: "2026-02-14",
          amountMinor: 700_000_00,
          currency: "USD",
          basis: "appraisal",
        },
      },
      estate,
    );
    await createAsset(
      { assetClass: "personalProperty", description: "Contents of the garage, not yet itemized" },
      estate,
    );

    const mortgage = await post(`/api/v1/matter-assets/${houseId}/encumbrances`, {
      kind: "mortgage",
      holderName: "First National",
      recordedReference: "2019-004471",
    });
    expect(mortgage.status).toBe(201);
    const { id: mortgageId } = (await mortgage.json()) as { id: string };
    // A balance is a VALUATION naming the charge — the same append-only table, the same as-of read.
    const balance = await post(`/api/v1/matter-assets/${houseId}/valuations`, {
      encumbranceId: mortgageId,
      asOfDate: "2026-02-14",
      amountMinor: 400_000_00,
      currency: "USD",
      basis: "statement",
    });
    expect(balance.status).toBe(201);

    const response = await get(`/api/v1/matters/${estate}/asset-schedule?asOf=2026-02-14`);
    expect(response.status).toBe(200);
    const schedule = (await response.json()) as {
      totalAssets: number;
      unvaluedCount: number;
      estateTreatmentCounts: Record<string, number>;
      groups: {
        assetClass: string;
        subtotals: {
          currency: string;
          valueAmountMinor: number;
          equityAmountMinor: number | null;
        }[];
        rows: { equity: { amountMinor: number | null } }[];
      }[];
    };
    expect(schedule.totalAssets).toBe(2);
    // Stated, not hidden.
    expect(schedule.unvaluedCount).toBe(1);
    expect(schedule.estateTreatmentCounts).toEqual({
      probateEstate: 1,
      nonProbateTransfer: 0,
      undetermined: 1,
    });
    const realProperty = schedule.groups.find((group) => group.assetClass === "realProperty");
    expect(realProperty?.subtotals).toEqual([
      {
        currency: "USD",
        valueAmountMinor: 700_000_00,
        equityAmountMinor: 300_000_00,
        countedAssets: 1,
      },
    ]);
    expect(realProperty?.rows[0]?.equity.amountMinor).toBe(300_000_00);
  });

  it("resolves an asset with no figure at the date as unvalued, never as zero", async () => {
    const estate = await createMatter("Estate of Vale");
    await createAsset(
      {
        assetClass: "realProperty",
        description: "The lakeside cabin",
        valuation: {
          asOfDate: "2026-07-01",
          amountMinor: 200_000_00,
          currency: "USD",
          basis: "appraisal",
        },
      },
      estate,
    );
    // The appraisal is dated July. As of the date of death in February there is no figure at or
    // before the date, and nothing extrapolates backwards.
    const response = await get(`/api/v1/matters/${estate}/asset-schedule?asOf=2026-02-14`);
    const schedule = (await response.json()) as {
      unvaluedCount: number;
      groups: {
        subtotals: unknown[];
        rows: {
          value: unknown;
          equity: { amountMinor: number | null; unavailableReason: string | null };
        }[];
      }[];
    };
    expect(schedule.unvaluedCount).toBe(1);
    expect(schedule.groups[0]?.subtotals).toEqual([]);
    expect(schedule.groups[0]?.rows[0]?.value).toBeNull();
    expect(schedule.groups[0]?.rows[0]?.equity.amountMinor).toBeNull();
    expect(schedule.groups[0]?.rows[0]?.equity.unavailableReason).toBe("no-value-as-of-date");
  });

  it("requires the as-of date and never assumes one", async () => {
    // Refused at the contract, not defaulted to today. A schedule with a date nobody chose is the
    // failure this subsystem most wants to avoid.
    const response = await get(`/api/v1/matters/${matterId}/asset-schedule`);
    expect(response.status).toBe(422);
  });

  it("refuses a balance naming a charge on another asset", async () => {
    const houseId = await createAsset({
      assetClass: "realProperty",
      description: "The house on Poplar Street",
    });
    const truckId = await createAsset({ assetClass: "vehicle", description: "The flatbed" });
    const charge = await post(`/api/v1/matter-assets/${houseId}/encumbrances`, {
      kind: "deedOfTrust",
      holderName: "Riverside Credit Union",
    });
    const { id: chargeId } = (await charge.json()) as { id: string };
    const misfiled = await post(`/api/v1/matter-assets/${truckId}/valuations`, {
      encumbranceId: chargeId,
      asOfDate: "2026-02-14",
      amountMinor: 100_00,
      currency: "USD",
      basis: "statement",
    });
    expect(misfiled.status).toBe(422);
    expect((await readJson<ProblemBody>(misfiled)).type).toContain(
      "matter-asset-encumbrance-not-on-asset",
    );
  });

  it("keeps a released charge on the record and out of the equity after the release date", async () => {
    const assetId = await createAsset({
      assetClass: "realProperty",
      description: "The house on Sycamore Street",
      valuation: {
        asOfDate: "2026-01-01",
        amountMinor: 500_000_00,
        currency: "USD",
        basis: "appraisal",
      },
    });
    const lien = await post(`/api/v1/matter-assets/${assetId}/encumbrances`, {
      kind: "lien",
      holderName: "Contractor",
    });
    const { id: lienId } = (await lien.json()) as { id: string };
    await post(`/api/v1/matter-assets/${assetId}/valuations`, {
      encumbranceId: lienId,
      asOfDate: "2026-01-01",
      amountMinor: 20_000_00,
      currency: "USD",
      basis: "statement",
    });
    const released = await post(`/api/v1/matter-assets/${assetId}/encumbrances/${lienId}/release`, {
      releasedOn: "2026-03-01",
    });
    expect(released.status).toBe(200);

    const before = (await (
      await get(`/api/v1/matter-assets/${assetId}?asOf=2026-02-01`)
    ).json()) as { equity: { amountMinor: number } };
    const after = (await (
      await get(`/api/v1/matter-assets/${assetId}?asOf=2026-06-01`)
    ).json()) as {
      equity: { amountMinor: number };
      encumbrances: { releasedOn: string | null }[];
    };
    expect(before.equity.amountMinor).toBe(480_000_00);
    expect(after.equity.amountMinor).toBe(500_000_00);
    // The row is still there and carries its date: "was this property clear at the date of death"
    // has to have an answer years after the lien was discharged.
    expect(after.encumbrances).toEqual([expect.objectContaining({ releasedOn: "2026-03-01" })]);
  });
});

describe("the safekeeping link", () => {
  it("links a scheduled asset to the item that holds it, and reads the placement rather than copying it", async () => {
    const now = clock.now();
    await firmDatabase
      .prepare(
        "INSERT INTO custody_location (id, name, kind, status, created_at, updated_at) VALUES (?1, ?2, 'safe', 'active', ?3, ?3)",
      )
      .bind("custodyLocation_routesTest0000000", "Main safe", now)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, created_at, updated_at) " +
          "VALUES (?1, 'CUS-09001', 'manual', 'Alvarez deposit', ?2, 'held', ?3, ?3)",
      )
      .bind("custodyPacket_routesTest000000000", "custodyLocation_routesTest0000000", now)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO custody_item (id, packet_id, ordinal, description, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, created_at, updated_at) " +
          "VALUES (?1, ?2, 1, 'Gold signet ring', 1, 250000, 'USD', 'held', ?3, ?3)",
      )
      .bind("custodyItem_routesTest00000000000", "custodyPacket_routesTest000000000", now)
      .run();

    const assetId = await createAsset({
      assetClass: "personalProperty",
      description: "Gold signet ring",
    });
    const linked = await patch(`/api/v1/matter-assets/${assetId}`, {
      custodyItemId: "custodyItem_routesTest00000000000",
    });
    expect(linked.status).toBe(200);

    const detail = (await (await get(`/api/v1/matter-assets/${assetId}`)).json()) as {
      asset: { custodyItemId: string | null };
      custody: {
        locationName: string;
        status: string;
        custodyNumber: string;
        held: boolean;
      } | null;
      valueAsOf: unknown;
    };
    expect(detail.asset.custodyItemId).toBe("custodyItem_routesTest00000000000");
    // Read from the safekeeping register at this moment, not copied onto the asset.
    expect(detail.custody?.locationName).toBe("Main safe");
    expect(detail.custody?.custodyNumber).toBe("CUS-09001");
    expect(detail.custody?.held).toBe(false);
    // And the safekeeping register's declared value did NOT become a valuation: the two numbers
    // answer different questions.
    expect(detail.valueAsOf ?? null).toBeNull();
  });

  it("refuses a link to an item that is not in the safekeeping register", async () => {
    const assetId = await createAsset({ assetClass: "other", description: "A thing" });
    const response = await patch(`/api/v1/matter-assets/${assetId}`, {
      custodyItemId: "custodyItem_nothingHere0000000000",
    });
    expect(response.status).toBe(422);
    expect((await readJson<ProblemBody>(response)).type).toContain(
      "matter-asset-unknown-custody-item",
    );
  });
});

describe("the firm's own fields on an asset", () => {
  // The firm's own fields reach an asset through the custom-fields engine and nothing else — this
  // register mints no second key/value store. So the round trip crosses two route surfaces on
  // purpose: the field is DEFINED and VALUED through /api/v1/custom-fields, and READ back on the
  // asset's own detail. If those two ever stop agreeing, this is the test that says so.
  async function defineAssetField(
    name: string,
    kind: string,
    assetClass: string | null,
  ): Promise<string> {
    const response = await post("/api/v1/custom-fields/fields", {
      name,
      kind,
      target: "matterAsset",
      attachmentId: assetClass,
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    return id;
  }

  async function setValue(fieldId: string, assetId: string, value: unknown): Promise<Response> {
    return SELF.fetch("https://example.com/api/v1/custom-fields/values", {
      method: "PUT",
      headers: authHeaders(ownerCookie, crypto.randomUUID()),
      body: JSON.stringify({ fieldId, targetRowId: assetId, value }),
    });
  }

  async function customFieldsOn(assetId: string) {
    const response = await get(`/api/v1/matter-assets/${assetId}`);
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      customFields: {
        fieldId: string;
        name: string;
        kind: string;
        valueText: string | null;
        valueNumber: number | null;
        valueId: string | null;
      }[];
    };
    return detail.customFields;
  }

  it("carries a firm's own field onto an asset and reads its value back on the detail", async () => {
    const fieldId = await defineAssetField("Homeowners association", "single-line", "realProperty");
    const assetId = await createAsset({
      assetClass: "realProperty",
      description: "The cabin at Incline Village",
    });

    expect(
      (await setValue(fieldId, assetId, { kind: "text", text: "Tahoe Ridge HOA" })).status,
    ).toBe(200);

    const fields = await customFieldsOn(assetId);
    const homeownersAssociation = fields.find((field) => field.fieldId === fieldId);
    expect(homeownersAssociation?.name).toBe("Homeowners association");
    expect(homeownersAssociation?.valueText).toBe("Tahoe Ridge HOA");
  });

  it("scopes a class-attached field to its class and leaves the other classes alone", async () => {
    const slipNumber = await defineAssetField("Slip number", "single-line", "vehicle");
    const boat = await createAsset({ assetClass: "vehicle", description: "The Boston Whaler" });
    const house = await createAsset({ assetClass: "realProperty", description: "The lake house" });

    expect((await setValue(slipNumber, boat, { kind: "text", text: "B-14" })).status).toBe(200);

    expect((await customFieldsOn(boat)).map((field) => field.fieldId)).toContain(slipNumber);
    // A field a firm attached to vehicles must not turn up on a house — the scoping is the whole
    // reason the attachment column carries the class rather than the field applying everywhere.
    expect((await customFieldsOn(house)).map((field) => field.fieldId)).not.toContain(slipNumber);
  });

  it("offers an unattached field on every class, unanswered until somebody answers it", async () => {
    const appraiser = await defineAssetField("Appraiser", "single-line", null);
    const ring = await createAsset({
      assetClass: "personalProperty",
      description: "The signet ring",
    });

    const before = (await customFieldsOn(ring)).find((field) => field.fieldId === appraiser);
    // Present and empty, not absent: "nobody has filled this in" and "this does not apply here"
    // are different facts and the detail must be able to say which.
    expect(before).toBeDefined();
    expect(before?.valueId).toBeNull();
    expect(before?.valueText).toBeNull();

    expect((await setValue(appraiser, ring, { kind: "text", text: "Marchetti & Co" })).status).toBe(
      200,
    );
    const after = (await customFieldsOn(ring)).find((field) => field.fieldId === appraiser);
    expect(after?.valueText).toBe("Marchetti & Co");
  });

  it("keeps a matter's own fields off the asset detail", async () => {
    const response = await post("/api/v1/custom-fields/fields", {
      name: "Referral source",
      kind: "single-line",
      target: "matter",
      attachmentId: null,
    });
    expect(response.status).toBe(201);
    const { id: matterFieldId } = (await response.json()) as { id: string };

    const asset = await createAsset({ assetClass: "other", description: "A thing" });
    expect((await customFieldsOn(asset)).map((field) => field.fieldId)).not.toContain(
      matterFieldId,
    );
  });

  it("still refuses a target the engine does not offer", async () => {
    const response = await post("/api/v1/custom-fields/fields", {
      name: "On a packet",
      kind: "single-line",
      target: "custodyPacket",
      attachmentId: null,
    });
    // The safekeeping register's own widening is a separate change on a separate axis; until it is
    // made, the request schema refuses the value rather than storing one no read recognises.
    expect(response.status).toBe(422);
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
