import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { firmResourceName } from "../src/firm-resource-provider.ts";
import { runScheduledSweep } from "../src/background/scheduled.ts";
import { handleIngestMessage } from "../src/background/files/ingest-consumer.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  setCookies,
  signIn,
} from "./support/test-auth.ts";

// The slice 1·1 capstone: one matter-management journey composed over the REAL HTTP surface
// (SELF fetch) as a sequence of `it` steps over module-level state. A firm is provisioned through
// POST /api/v1/firms, its owner activates through the emailed reset link, signs in, and is mirrored
// by the scheduled sweep — then the whole slice composes: a Location and a matter type, a
// location+year+counter numbering scheme, a consultation that draws no number, opening it to draw
// RENO-<yy>-0001, an upload driven through ingest to a clean visible version, an identical re-upload
// that no-ops, a declared-type lie that quarantines invisibly, a policy-blocked extension refused at
// initiate, a bulk download, closing the matter, and adding a document to the now-closed matter
// (archived-but-additive). Tenant isolation is asserted at the database level against the second
// dev-pool binding, which carries none of this firm's matters or files.
//
// Storage is per-test-FILE, so this file owns its own isolated pool; the journey claims the first
// binding for the provisioned firm and uses the second only for the isolation read.

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

const FIRM_INPUT = {
  name: "Capstone Firm",
  owner: { email: "capstone-owner@example.com", name: "Capstone Owner" },
};

// PDF magic bytes — sniffed as application/pdf at the ingest gate.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
// A distinct clean payload (a second matter document) — different bytes, different hash.
const SECOND_PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n2 0 obj\n<< /Second true >>\nendobj\ntrailer\n%%EOF\n",
);
// The dev resource provider records a per-firm-unique deterministic bucket name (the ingest
// consumer's event→firm resolution key); set from the provisioned firm in the first step.
let bucketName = "";

// The location+year(2)+counter scheme that renders like RENO-26-0001.
const SCHEME = [
  { kind: "location_code" },
  { kind: "literal", text: "-" },
  { kind: "year", digits: 2 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];
// The rendered number's expected shape (the year digits track the real clock the service reads).
const NUMBER_SHAPE = /^RENO-\d{2}-0001$/;
const TWO_DIGIT_YEAR = String(new Date().getFullYear()).slice(2, 4);

// Set by the journey's earlier steps; later steps run in this file's guaranteed-sequential order.
let firm: ProvisionResponseBody;
let ownerCookie = "";
let locationId = "";
let consultationId = "";
let openMatterId = "";
let uploadedFileId = "";
let isolationFirmId = "";

beforeAll(async () => {
  // Control plane only — the provisioner migrates the claimed pool firm database itself.
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // An isolation firmId whose DO will be empty — used in the isolation step to prove no tenant bleed.
  isolationFirmId = newIdentifier("firm");
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

function ingestEvent(key: string, size: number) {
  return { bucket: bucketName, object: { key, size }, action: "PutObject" };
}

// Initiates an upload over the HTTP surface, writes the bytes into the Miniflare R2 binding at the
// returned key, then drives the ingest consumer with a synthetic R2 object-create event — exactly the
// production pipeline (Miniflare delivers no real R2 notifications). Returns the file/version ids.
async function uploadAndIngest(
  body: Record<string, unknown>,
  bytes: Uint8Array,
): Promise<{ fileId: string; versionId: string; key: string }> {
  const response = await post("/api/v1/uploads", body);
  expect(response.status).toBe(201);
  const initiated = (await response.json()) as {
    mode: string;
    fileId: string;
    versionId: string;
    key: string;
  };
  expect(initiated.mode).toBe("put");
  await env.R2.put(initiated.key, bytes);
  await handleIngestMessage(env, ingestEvent(initiated.key, bytes.byteLength));
  return { fileId: initiated.fileId, versionId: initiated.versionId, key: initiated.key };
}

describe("slice 1·1 end-to-end", () => {
  it("provisions a firm and activates its owner into a live session", async () => {
    const provisionResponse = await SELF.fetch("https://example.com/api/v1/firms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(FIRM_INPUT),
    });
    expect(provisionResponse.status).toBe(201);
    firm = (await provisionResponse.json()) as ProvisionResponseBody;
    expect(firm.status).toBe("active");

    // The dev resource provider records a per-firm-unique deterministic bucket name (the ingest
    // consumer's event→firm resolution key); the firm's per-firm database is its firmId-addressed
    // FirmDatabase DO, which self-migrates on first access and needs no provisioning step.
    const firmRow = await env.DB_CONTROL.prepare("SELECT bucket_name FROM firm WHERE id = ?1")
      .bind(firm.id)
      .first<{ bucket_name: string }>();
    expect(firmRow?.bucket_name).toBe(await firmResourceName(firm.id as FirmId));
    bucketName = firmRow?.bucket_name ?? "";

    // Activation: set the password through the emailed reset link, then sign in for the session.
    const { token } = await captureResetToken(FIRM_INPUT.owner.email);
    const resetResponse = await postJson("/api/auth/reset-password", {
      newPassword: PASSWORD,
      token,
    });
    expect(resetResponse.status).toBe(200);
    const signInResponse = await signIn(FIRM_INPUT.owner.email);
    expect(signInResponse.status).toBe(200);
    ownerCookie = liveCookie(setCookies(signInResponse), "session_token")?.pair ?? "";
    expect(ownerCookie).not.toBe("");

    // The sweep mirrors the owner into the firm database as an active Admin member — the member
    // row every firm-scoped route resolves the session against.
    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);
    const memberResults = await firmDatabaseFor(env.FIRM_DATABASE, firm.id as FirmId)
      .prepare("SELECT status FROM member WHERE user_id = ?1")
      .bind(firm.owner.id)
      .all<{ status: string }>();
    expect(memberResults.results[0]?.status).toBe("active");
  });

  it("creates a Location and a matter type", async () => {
    const locationResponse = await post("/api/v1/locations", { name: "Reno", numberCode: "RENO" });
    expect(locationResponse.status).toBe(201);
    locationId = ((await locationResponse.json()) as { id: string }).id;
    expect(locationId).toMatch(/^location_/);

    const typeResponse = await post("/api/v1/matter-types", {
      name: "Personal Injury",
      code: "PI",
    });
    expect(typeResponse.status).toBe(201);
  });

  it("sets a location+year+counter numbering scheme", async () => {
    const setResponse = await put("/api/v1/numbering-scheme", { segments: SCHEME });
    expect(setResponse.status).toBe(200);
    const getResponse = await get("/api/v1/numbering-scheme");
    expect(getResponse.status).toBe(200);
    expect(((await getResponse.json()) as { segments: unknown }).segments).toEqual(SCHEME);
  });

  it("creates a consultation that carries no number and sits only in the Consultations view", async () => {
    const response = await post("/api/v1/matters", {
      title: "Consultation Smith",
      status: "consultation",
      responsibleMemberId: firm.owner.id,
      locationId,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { matterId: string; matterNumber: null };
    expect(body.matterNumber).toBeNull();
    consultationId = body.matterId;

    // Absent from the working caseload (the default list excludes consultation matters).
    const list = await get("/api/v1/matters");
    const listBody = (await list.json()) as { data: { id: string }[] };
    expect(listBody.data.some((m) => m.id === consultationId)).toBe(false);

    // Present in the Consultations view.
    const consultations = await get("/api/v1/matters/consultations");
    const consultationsBody = (await consultations.json()) as { data: { id: string }[] };
    expect(consultationsBody.data.some((m) => m.id === consultationId)).toBe(true);
  });

  it("opens the consultation, drawing the location-scoped first number", async () => {
    const response = await post(`/api/v1/matters/${consultationId}/open`, {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { matterId: string; matterNumber: string };
    expect(body.matterNumber).toMatch(NUMBER_SHAPE);
    expect(body.matterNumber).toBe(`RENO-${TWO_DIGIT_YEAR}-0001`);
    openMatterId = body.matterId;

    // The opened matter now appears in the working caseload.
    const list = await get("/api/v1/matters");
    const listBody = (await list.json()) as { data: { id: string }[] };
    expect(listBody.data.some((m) => m.id === openMatterId)).toBe(true);
  });

  it("uploads a document, drives ingest to a clean version, and lists it", async () => {
    const { fileId, versionId } = await uploadAndIngest(
      {
        matterId: openMatterId,
        name: "brief.pdf",
        declaredSize: PDF_BYTES.byteLength,
        declaredContentType: "application/pdf",
      },
      PDF_BYTES,
    );
    uploadedFileId = fileId;

    const versionResults = await firmDatabaseFor(env.FIRM_DATABASE, firm.id as FirmId)
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    expect(versionResults.results[0]?.status).toBe("clean");

    const files = await get(`/api/v1/files?matterId=${openMatterId}`);
    const filesBody = (await files.json()) as { data: { id: string; name: string }[] };
    expect(filesBody.data.some((f) => f.id === uploadedFileId && f.name === "brief.pdf")).toBe(
      true,
    );
  });

  it("no-ops a re-upload of identical bytes to the same file (still one committed version)", async () => {
    const response = await post("/api/v1/uploads", {
      matterId: openMatterId,
      fileId: uploadedFileId,
      name: "brief.pdf",
      declaredSize: PDF_BYTES.byteLength,
      declaredContentType: "application/pdf",
    });
    expect(response.status).toBe(201);
    const initiated = (await response.json()) as { key: string; versionId: string };
    await env.R2.put(initiated.key, PDF_BYTES);
    await handleIngestMessage(env, ingestEvent(initiated.key, PDF_BYTES.byteLength));

    // The identical-hash version is abandoned, not committed — the file keeps a single clean version.
    const secondVersionResults = await firmDatabaseFor(env.FIRM_DATABASE, firm.id as FirmId)
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(initiated.versionId)
      .all<{ status: string }>();
    expect(secondVersionResults.results[0]?.status).toBe("abandoned");

    const versions = await get(`/api/v1/files/${uploadedFileId}/versions`);
    const versionsBody = (await versions.json()) as { data: unknown[] };
    expect(versionsBody.data.length).toBe(1);
  });

  it("quarantines a declared-type lie at the gate (invisible in the file list)", async () => {
    // PDF bytes declared as text/plain — the sniffed magic bytes contradict the declared type.
    const response = await post("/api/v1/uploads", {
      matterId: openMatterId,
      name: "liar.txt",
      declaredSize: PDF_BYTES.byteLength,
      declaredContentType: "text/plain",
    });
    expect(response.status).toBe(201);
    const initiated = (await response.json()) as { key: string; versionId: string; fileId: string };
    await env.R2.put(initiated.key, PDF_BYTES);
    await handleIngestMessage(env, ingestEvent(initiated.key, PDF_BYTES.byteLength));

    const quarantinedResults = await firmDatabaseFor(env.FIRM_DATABASE, firm.id as FirmId)
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(initiated.versionId)
      .all<{ status: string }>();
    expect(quarantinedResults.results[0]?.status).toBe("quarantined");

    const files = await get(`/api/v1/files?matterId=${openMatterId}`);
    const filesBody = (await files.json()) as { data: { name: string }[] };
    expect(filesBody.data.some((f) => f.name === "liar.txt")).toBe(false);
  });

  it("refuses a policy-blocked extension at initiate (422)", async () => {
    const response = await post("/api/v1/uploads", {
      matterId: openMatterId,
      name: "malware.exe",
      declaredSize: 10,
      declaredContentType: "application/pdf",
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { type: string }).type).toBe(
      "https://api.magnacarta.esq/problems/upload-not-allowed",
    );

    // It never became a file — the working list still holds only the clean brief.
    const files = await get(`/api/v1/files?matterId=${openMatterId}`);
    const filesBody = (await files.json()) as { data: { name: string }[] };
    expect(filesBody.data.some((f) => f.name === "malware.exe")).toBe(false);
  });

  it("bulk-downloads the matter's clean files", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/downloads/zip", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
      },
      body: JSON.stringify({ matterId: openMatterId }),
      redirect: "manual",
    });
    // A single clean file resolves to a presigned-GET redirect rather than a streamed archive.
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("dev-presigned=get");
  });

  it("closes the matter", async () => {
    const response = await post(`/api/v1/matters/${openMatterId}/close`, {});
    expect(response.status).toBe(200);
    const detail = await get(`/api/v1/matters/${openMatterId}`);
    expect(((await detail.json()) as { status: string }).status).toBe("closed");
  });

  it("adds a document to the closed matter (archived-but-additive)", async () => {
    const { fileId, versionId } = await uploadAndIngest(
      {
        matterId: openMatterId,
        name: "post-close.pdf",
        declaredSize: SECOND_PDF_BYTES.byteLength,
        declaredContentType: "application/pdf",
      },
      SECOND_PDF_BYTES,
    );

    const postCloseVersionResults = await firmDatabaseFor(env.FIRM_DATABASE, firm.id as FirmId)
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    expect(postCloseVersionResults.results[0]?.status).toBe("clean");

    const files = await get(`/api/v1/files?matterId=${openMatterId}`);
    const filesBody = (await files.json()) as { data: { id: string }[] };
    expect(filesBody.data.some((f) => f.id === fileId)).toBe(true);
  });

  it("leaves the second tenant's database untouched (isolation)", async () => {
    // A fresh firmId whose DO has never been written to carries none of this journey's matters,
    // files, or versions — exhaustive counts, so no row can hide.
    const isolationDatabase = firmDatabaseFor(env.FIRM_DATABASE, isolationFirmId);
    const mattersResult = await isolationDatabase
      .prepare("SELECT COUNT(*) AS n FROM matter")
      .all<{ n: number }>();
    expect(mattersResult.results[0]?.n).toBe(0);
    const filesResult = await isolationDatabase
      .prepare("SELECT COUNT(*) AS n FROM file")
      .all<{ n: number }>();
    expect(filesResult.results[0]?.n).toBe(0);
    const versionsResult = await isolationDatabase
      .prepare("SELECT COUNT(*) AS n FROM file_version WHERE status IS NOT NULL")
      .all<{ n: number }>();
    expect(versionsResult.results[0]?.n).toBe(0);
  });
});
