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

// The discovery surface, driven through the chokepoint over real Miniflare bindings: a firm opens a
// matter, creates a review set, names whose records are in it, declares a load, and pulls its own
// matter files into the corpus. No bytes move at any point.
//
// This block seeds its OWN firm. The chokepoint's rate-limit key is `firm:<firmId>`, so a suite that
// makes this many requests would otherwise spend another block's window and start collecting 429s.

let firmId: FirmId;
let ownerCookie: string;
let matterOnlyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerUserId: UserId;
let matterId: string;
let reviewSetId: string;

const clock = { now: () => new Date().toISOString() };

// A member with FULL matter and file access and NO discovery grant. This is the access rule made
// testable: material produced by another party may be attorney's-eyes-only under a protective order,
// so reaching a review set has to follow from a discovery grant and from nothing else.
async function mirrorMemberWithMatterGrantsOnly(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: clock.now() }).run();
  for (const permission of [
    "matters:create",
    "matters:edit",
    "files:upload",
    "files:organize",
    "files:delete",
    "emails:read",
    "emails:file",
  ]) {
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

// A stored file with a clean version, seeded directly. NO BYTES ever reach a discovery route: the
// internal lanes are a SELECTION, not an upload, and the platform already holds the bytes, the hash,
// and the scan verdict. Seeding the handles is exactly what the lane resolves against.
//
// Three statements rather than two, because `file.current_version_id` and `file_version.file_id`
// point at each other: the file is written with no current version, the version is written against
// it, and only then does the file point back. Writing the file with its version id up front is a
// forward reference the foreign key refuses — which is the real ingest path's ordering too.
// The handles are MINTED rather than written by hand: a route validates every identifier it is
// handed against the platform's own handle shape, so a readable-but-invalid `file_internal_one`
// never reaches a handler — it is refused at the schema gate, which is the gate working.
//
// `committed_at` IS DELIBERATELY LEFT NULL, and it is not an oversight. These versions are inserted
// straight into the table; they never travelled the ingest pipeline, and that column records the
// instant a version actually committed through it. Claiming one would be a small lie with a real
// consequence: the search re-extraction sweep walks EVERY active firm in the control plane and
// treats a clean, committed, not-yet-indexed version as a document owed a repair, so a fixture
// firm asserting a commit it never made joins the fleet's re-extraction backlog and moves that
// sweep's fleet-wide counts. The discovery lanes resolve on `status` and `current_version_id` and
// never read this column, so leaving it null is both the honest record and the isolated one.
async function seedCleanFile(
  name: string,
  options: { status?: string; matter?: string; sha256?: string } = {},
): Promise<{ fileId: string; versionId: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const belongsTo = options.matter ?? matterId;
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
        "VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, belongsTo, name, clock.now())
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, created_at, committed_at) " +
        "VALUES (?1, ?2, 1, ?3, 4096, ?4, ?5, ?6, NULL)",
    )
    .bind(
      versionId,
      fileId,
      `objects/${versionId}`,
      options.sha256 ?? `sha256-${fileId}`,
      options.status ?? "clean",
      clock.now(),
    )
    .run();
  await firmDatabase
    .prepare("UPDATE file SET current_version_id = ?2, updated_at = ?3 WHERE id = ?1")
    .bind(fileId, versionId, clock.now())
    .run();
  return { fileId, versionId };
}

async function createReviewSet(name: string): Promise<string> {
  const response = await post(`/api/v1/matters/${matterId}/review-sets`, { name });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

async function createRecordCustodian(setId: string, displayName: string): Promise<string> {
  const response = await post(`/api/v1/review-sets/${setId}/record-custodians`, {
    displayName,
    kind: "person",
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

async function declareLoad(
  setId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await post(`/api/v1/review-sets/${setId}/loads`, body);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Discovery Test Firm" })).firmId;
  await seedFirmKey(firmId);
  // A firm that holds documents has a bucket to hold them in, and a load only finishes once its
  // documents have been queued to be READ — which needs somewhere to read them from. Seeded here
  // because seedFirm leaves the bucket unprovisioned, which is a state no firm with files is in.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, "magna-carta-production-platform-files")
    .run();
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("discovery-owner@example.com", {
    userName: "Discovery Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Discovery Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("discovery-owner@example.com");

  const matterOnly = await seedCredentialedUser("discovery-matter-only@example.com", {
    userName: "Matter Team Member",
    firmId,
  });
  await mirrorMemberWithMatterGrantsOnly(firmDatabase, matterOnly.userId, "Matter Team Member");
  matterOnlyCookie = await signInForSessionCookie("discovery-matter-only@example.com");

  matterId = await createMatter("Vasquez v. Northgate");
  reviewSetId = await createReviewSet("Our collection");
});

describe("the review set", () => {
  it("is created open and empty with the firm's ceiling snapshotted onto it", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}`);
    expect(response.status).toBe(200);
    const set = (await response.json()) as Record<string, unknown>;
    expect(set.state).toBe("open");
    expect(set.documentCount).toBe(0);
    expect(set.matterId).toBe(matterId);
    // Off unless a firm chooses it: embedding a large corpus is a real metered cost incurred
    // whether or not anyone ever runs a semantic query.
    expect(set.semanticIndexEnabled).toBe(false);
    expect(set.documentCeiling).toBe(250_000);
  });

  it("lists every review set the member may reach, across matters, from one address", async () => {
    // The firm-wide register's read. It is scoped by the per-review-set access list rather than by
    // matter access, which is the whole reason it exists: a reviewer brought in for one production
    // is on that review set's list and may hold no access at all to the matter it belongs to.
    const response = await get("/api/v1/review-sets");
    expect(response.status).toBe(200);
    const page = (await response.json()) as { data: { name: string; matterId: string }[] };
    expect(page.data.map((row) => row.name)).toContain("Our collection");
    // The matter rides the row, because that is how a person tells four review sets apart.
    expect(page.data.every((row) => typeof row.matterId === "string")).toBe(true);
  });

  it("refuses the firm-wide register to a member with matter access and no discovery grant", async () => {
    const response = await get("/api/v1/review-sets", matterOnlyCookie);
    expect(response.status).toBe(403);
  });

  it("refuses a second review set with the same name on the same matter", async () => {
    const response = await post(`/api/v1/matters/${matterId}/review-sets`, {
      name: "Our collection",
    });
    expect(response.status).toBe(409);
  });

  it("lists the matter's review sets", async () => {
    const response = await get(`/api/v1/matters/${matterId}/review-sets`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as { data: { name: string }[] };
    expect(page.data.map((row) => row.name)).toContain("Our collection");
  });

  // Forward-only, and the refusal explains itself: the corpus under review is what was reviewed,
  // and a set that could be reopened is a corpus whose contents depend on when you looked.
  it("locks, closes, and refuses a reopen by name", async () => {
    const setId = await createReviewSet("Second request");
    const locked = await post(`/api/v1/review-sets/${setId}/state`, { state: "locked" });
    expect(locked.status).toBe(200);
    expect((await readJson<{ state: string }>(locked)).state).toBe("locked");

    const closed = await post(`/api/v1/review-sets/${setId}/state`, { state: "closed" });
    expect(closed.status).toBe(200);
    expect((await readJson<{ state: string }>(closed)).state).toBe("closed");

    // There is no route that could ask for `open` — the request schema does not offer it — so the
    // reopen a firm actually attempts is a re-lock of a closed set.
    const reopened = await post(`/api/v1/review-sets/${setId}/state`, { state: "locked" });
    expect(reopened.status).toBe(422);
    const problem = (await reopened.json()) as { type: string; detail: string };
    expect(problem.type).toContain("discovery-review-set-reopen-refused");
    expect(problem.detail).toContain("what was reviewed");
  });

  // The two records the whole ingest lane exists to produce, and the only way to reach them. Before
  // this route they were an R2 key on a row: written, correct, and unreachable by anybody.
  it("answers 404 for a load's records until the load has written them", async () => {
    const setId = await createReviewSet("Records not yet written");
    await createRecordCustodian(setId, "A. Keeper");
    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 1,
    });
    expect(declared.status).toBe(201);
    const loadId = declared.body.id as string;

    for (const artifact of ["manifest", "exception-report"]) {
      for (const format of ["json", "text"]) {
        const response = await get(
          `/api/v1/loads/${loadId}/artifacts/${artifact}?format=${format}`,
        );
        expect(response.status).toBe(404);
        const problem = (await response.json()) as ProblemBody;
        // The 404 says WHY rather than only refusing: a record is written once, when every document
        // in the load has reached a terminal state, and a firm looking for it early needs to know
        // that it is early rather than that something is broken.
        expect(problem.detail).toContain("terminal state");
      }
    }
  });

  it("refuses a load's records to a member with matter access and no discovery grant", async () => {
    const response = await get(
      `/api/v1/loads/discoveryLoad_absent00000000000000/artifacts/manifest`,
      matterOnlyCookie,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a load into a review set that no longer takes material", async () => {
    const setId = await createReviewSet("Closed to loading");
    await post(`/api/v1/review-sets/${setId}/state`, { state: "locked" });
    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 1,
    });
    expect(declared.status).toBe(409);
    expect(String(declared.body.type)).toContain("discovery-review-set-closed");
  });

  it("turns the semantic half on and off by name", async () => {
    const response = await patch(`/api/v1/review-sets/${reviewSetId}`, {
      semanticIndexEnabled: true,
    });
    expect(response.status).toBe(200);
    expect((await readJson<{ semanticIndexEnabled: boolean }>(response)).semanticIndexEnabled).toBe(
      true,
    );
    const off = await patch(`/api/v1/review-sets/${reviewSetId}`, { semanticIndexEnabled: false });
    expect((await readJson<{ semanticIndexEnabled: boolean }>(off)).semanticIndexEnabled).toBe(
      false,
    );
  });
});

// THE ACCESS RULE. A member with every matters:* and files:* grant on the matter holds no discovery
// key by that fact, and reaches no review set on it.
describe("matter access does not imply review-set access", () => {
  it("refuses every discovery route to a member holding only matter and file grants", async () => {
    const read = await get(`/api/v1/review-sets/${reviewSetId}`, matterOnlyCookie);
    expect(read.status).toBe(403);

    const list = await get(`/api/v1/matters/${matterId}/review-sets`, matterOnlyCookie);
    expect(list.status).toBe(403);

    const create = await post(
      `/api/v1/matters/${matterId}/review-sets`,
      { name: "Not allowed" },
      matterOnlyCookie,
    );
    expect(create.status).toBe(403);

    const declared = await post(
      `/api/v1/review-sets/${reviewSetId}/loads`,
      { lane: "internal-files", transcriptScope: "exclude", declaredDocumentCount: 1 },
      matterOnlyCookie,
    );
    expect(declared.status).toBe(403);
  });
});

describe("record custodians", () => {
  it("records whose records these were, scoped to the review set", async () => {
    const id = await createRecordCustodian(reviewSetId, "Ana Vasquez");
    const listed = await get(`/api/v1/review-sets/${reviewSetId}/record-custodians`);
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as { data: { id: string; displayName: string }[] };
    expect(page.data.some((row) => row.id === id && row.displayName === "Ana Vasquez")).toBe(true);
  });

  it("refuses two custodians with the same name in one review set", async () => {
    await createRecordCustodian(reviewSetId, "Duplicate Name");
    const again = await post(`/api/v1/review-sets/${reviewSetId}/record-custodians`, {
      displayName: "Duplicate Name",
      kind: "person",
    });
    expect(again.status).toBe(409);
  });

  // The same name in two review sets is not assertably the same person, and asserting it wrongly is
  // a defensibility problem — so the same name is allowed in a different set.
  it("allows the same name in a different review set", async () => {
    const otherSet = await createReviewSet("Plaintiff's production");
    const response = await post(`/api/v1/review-sets/${otherSet}/record-custodians`, {
      displayName: "Ana Vasquez",
      kind: "person",
    });
    expect(response.status).toBe(201);
  });

  // Correcting a custodian re-points every document already attributed to it, and that IS the
  // intent: a production that named "J. Smith" and the person the firm later identified are one
  // custodian, and a second row would split the attribution.
  it("corrects a custodian in place rather than making a second one", async () => {
    const setId = await createReviewSet("Correction test");
    const id = await createRecordCustodian(setId, "J. Smith");
    const response = await patch(`/api/v1/record-custodians/${id}`, {
      displayName: "Jordan Smith",
      kind: "person",
    });
    expect(response.status).toBe(200);
    expect((await readJson<{ displayName: string }>(response)).displayName).toBe("Jordan Smith");
    const listed = await get(`/api/v1/review-sets/${setId}/record-custodians`);
    const page = (await listed.json()) as { data: unknown[] };
    expect(page.data).toHaveLength(1);
  });

  // `unattributed` is a real kind rather than a blank: material that arrived with no custodial
  // attribution is a fact worth recording as one.
  it("records the unattributed case as a kind rather than as a null", async () => {
    const setId = await createReviewSet("Unattributed test");
    const response = await post(`/api/v1/review-sets/${setId}/record-custodians`, {
      displayName: "Unattributed",
      kind: "unattributed",
    });
    expect(response.status).toBe(201);
  });
});

describe("declaring a load", () => {
  // THE TRANSCRIPT CONTROL. Required, with no default in either direction.
  it("refuses a declaration that does not say whether transcripts are in scope", async () => {
    const response = await post(`/api/v1/review-sets/${reviewSetId}/loads`, {
      lane: "internal-files",
      declaredDocumentCount: 3,
    });
    // The request schema demands the field, so the shape gate catches it before a handler runs —
    // which is the stronger place for it: a body with no transcriptScope cannot reach code that
    // might supply one. There is no default anywhere on the path, in either direction.
    expect(response.status).toBe(422);
    expect(String((await readJson<ProblemBody>(response)).type)).toContain("validation");
  });

  it("refuses an include by name rather than dropping it or pretending to honour it", async () => {
    const declared = await declareLoad(reviewSetId, {
      lane: "internal-files",
      transcriptScope: "include",
      declaredDocumentCount: 3,
    });
    expect(declared.status).toBe(422);
    expect(String(declared.body.type)).toContain("discovery-load-source-not-built");
    expect(String(declared.body.detail)).toContain("transcripts");
  });

  it("records the scope on the load so the provenance read can state it", async () => {
    const declared = await declareLoad(reviewSetId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 2,
      sourceDescription: "The client's working folder",
    });
    expect(declared.status).toBe(201);
    const read = await get(`/api/v1/loads/${String(declared.body.id)}`);
    const load = (await read.json()) as Record<string, unknown>;
    expect(load.transcriptScope).toBe("exclude");
    expect(load.state).toBe("declared");
    expect(load.declaredDocumentCount).toBe(2);
    expect(load.sourceDescription).toBe("The client's working folder");
  });

  // Declared and refused BY NAME so its absence is visible: collecting from a client's own system
  // needs a collection tool, not an ingest path.
  it("refuses the direct-collection lane by name", async () => {
    const declared = await declareLoad(reviewSetId, {
      lane: "direct-collection",
      transcriptScope: "exclude",
      declaredDocumentCount: 1,
    });
    expect(declared.status).toBe(422);
    expect(String(declared.body.type)).toContain("discovery-load-source-not-built");
  });

  // REFUSED, never degraded, with both numbers in the message.
  it("refuses a load past the ceiling with the count and the ceiling in the message", async () => {
    const setId = await createReviewSet("Ceiling test");
    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 250_001,
    });
    expect(declared.status).toBe(422);
    expect(String(declared.body.type)).toContain("discovery-ceiling-exceeded");
    expect(String(declared.body.detail)).toContain("250000");
  });

  it("lists a review set's loads as the provenance record", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/loads`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      data: { lane: string; transcriptScope: string; initiatedBy: string }[];
    };
    expect(page.data.length).toBeGreaterThan(0);
    for (const row of page.data) {
      expect(row.transcriptScope).toBe("exclude");
      expect(row.initiatedBy).toBe(ownerUserId);
    }
  });
});

describe("the internal file lane", () => {
  it("resolves a selection into review documents without moving a byte", async () => {
    const setId = await createReviewSet("Internal files");
    const custodianId = await createRecordCustodian(setId, "Ana Vasquez");
    const first = await seedCleanFile("contract.docx");
    const second = await seedCleanFile("invoice.pdf");

    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 2,
    });
    expect(declared.status).toBe(201);
    const loadId = String(declared.body.id);

    const run = await post(`/api/v1/loads/${loadId}/internal-selection`, {
      recordCustodianId: custodianId,
      fileIds: [first.fileId, second.fileId],
    });
    expect(run.status).toBe(202);
    const turn = (await run.json()) as {
      plannedCount: number;
      allocatedCount: number;
      complete: boolean;
    };
    expect(turn.plannedCount).toBe(2);
    expect(turn.allocatedCount).toBe(2);
    expect(turn.complete).toBe(true);

    // The load's counts and the review set's count both moved, in the same batch as the rows.
    const load = (await (await get(`/api/v1/loads/${loadId}`)).json()) as Record<string, unknown>;
    expect(load.loadedDocumentCount).toBe(2);
    expect(load.state).toBe("processing");
    const set = (await (await get(`/api/v1/review-sets/${setId}`)).json()) as {
      documentCount: number;
    };
    expect(set.documentCount).toBe(2);

    // The review documents point at the VERSION and carry no bytes.
    const { results } = await firmDatabase
      .prepare(
        "SELECT file_version_id, family_id, id, family_role, processing_state, content_sha256 FROM review_document WHERE review_set_id = ?1 ORDER BY source_name",
      )
      .bind(setId)
      .all<{
        file_version_id: string;
        family_id: string;
        id: string;
        family_role: string;
        processing_state: string;
        content_sha256: string;
      }>();
    expect(results).toHaveLength(2);
    // The versions the load PINNED — a snapshot of what was there, not a subscription to the files.
    expect(results.map((row) => row.file_version_id).sort()).toEqual(
      [first.versionId, second.versionId].sort(),
    );
    for (const row of results) {
      // A standalone document is its own family, so every document has one.
      expect(row.family_id).toBe(row.id);
      expect(row.family_role).toBe("standalone");
      expect(row.processing_state).toBe("pending");
      // The hash was already computed at ingest, so exact dedup is free at load time.
      expect(row.content_sha256).toMatch(/^sha256-file_/);
    }
  });

  // A quarantined version is not review material. Refused BY NAME rather than skipped: a firm that
  // selected two files and silently got one has a corpus it cannot certify.
  it("refuses a quarantined version by name rather than skipping it", async () => {
    const setId = await createReviewSet("Quarantine test");
    const custodianId = await createRecordCustodian(setId, "Ana Vasquez");
    const quarantined = await seedCleanFile("malware.doc", { status: "quarantined" });
    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 1,
    });
    const run = await post(`/api/v1/loads/${String(declared.body.id)}/internal-selection`, {
      recordCustodianId: custodianId,
      fileIds: [quarantined.fileId],
    });
    expect(run.status).toBe(422);
    const problem = (await run.json()) as { type: string; detail: string };
    expect(problem.type).toContain("discovery-selection-refused");
    expect(problem.detail).toContain("quarantined");
  });

  // A review set is one matter's corpus. A load that reached across matters would put another
  // case's documents in a corpus a firm is about to certify the contents of.
  it("refuses a selection reaching outside the review set's matter", async () => {
    const otherMatter = await createMatter("Unrelated matter");
    const setId = await createReviewSet("Cross-matter test");
    const custodianId = await createRecordCustodian(setId, "Ana Vasquez");
    const stranger = await seedCleanFile("stranger.docx", { matter: otherMatter });
    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 1,
    });
    const run = await post(`/api/v1/loads/${String(declared.body.id)}/internal-selection`, {
      recordCustodianId: custodianId,
      fileIds: [stranger.fileId],
    });
    expect(run.status).toBe(422);
    expect(String((await readJson<ProblemBody>(run)).type)).toContain(
      "discovery-selection-refused",
    );
  });

  // Structural idempotency from the derived key rather than a guard: a retried run converges on the
  // rows it already wrote. The coordinator's cursor is what makes the second turn a no-op.
  it("converges rather than duplicating when the same selection runs twice", async () => {
    const setId = await createReviewSet("Idempotency test");
    const custodianId = await createRecordCustodian(setId, "Ana Vasquez");
    const retried = await seedCleanFile("retried.docx");
    const declared = await declareLoad(setId, {
      lane: "internal-files",
      transcriptScope: "exclude",
      declaredDocumentCount: 1,
    });
    const loadId = String(declared.body.id);
    const body = { recordCustodianId: custodianId, fileIds: [retried.fileId] };

    const first = await post(`/api/v1/loads/${loadId}/internal-selection`, body);
    expect(first.status).toBe(202);
    const second = await post(`/api/v1/loads/${loadId}/internal-selection`, body);
    expect(second.status).toBe(202);

    const { results } = await firmDatabase
      .prepare("SELECT id FROM review_document WHERE review_set_id = ?1")
      .bind(setId)
      .all<{ id: string }>();
    expect(results).toHaveLength(1);
  });
});
