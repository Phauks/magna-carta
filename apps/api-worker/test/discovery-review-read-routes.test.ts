import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The reads the review surface pages through, driven through the chokepoint over real bindings — and
// the wall in front of every one of them.
//
// The stranger below holds EVERY discovery permission and is on no access list. What has to be true of
// each read is not merely that it refuses: it must be indistinguishable from a review set that does
// not exist. A 403 would name the corpus, which on material an opposing party produced under a
// protective order is itself the disclosure.
//
// This block seeds its OWN firm — the chokepoint's rate-limit key is `firm:<firmId>`, so sharing one
// with another block would spend its window and start collecting 429s.

let firmId: FirmId;
let ownerCookie: string;
let strangerCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerUserId: UserId;
let matterId: string;
let reviewSetId: string;
let loadId: string;
let recordCustodianId: string;

const clock = { now: () => new Date().toISOString() };

async function mirrorMemberWithEveryDiscoveryGrant(
  database: ReturnType<typeof firmDatabaseFor>,
  userId: UserId,
  displayName: string,
): Promise<void> {
  await insertMemberStatement(database, { userId, displayName, now: clock.now() }).run();
  for (const permission of [
    "discovery:read",
    "discovery:manageReviewSets",
    "discovery:load",
    "discovery:review",
    "discovery:produce",
    "matters:create",
    "matters:edit",
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

async function post(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, crypto.randomUUID()),
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

// Two documents in one family plus an excepted one, written directly: the load lanes are exercised by
// their own suites, and what these reads need is a corpus with something in it.
async function seedCorpus(): Promise<{
  readonly familyParent: string;
  readonly familyChild: string;
  readonly excepted: string;
}> {
  const at = clock.now();
  const made: string[] = [];
  for (const [ordinal, sortDate] of [
    [0, "2026-03-01T00:00:00.000Z"],
    [1, "2026-02-01T00:00:00.000Z"],
    [2, null],
  ] as const) {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const documentId = newIdentifier("reviewDocument");
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
      )
      .bind(fileId, matterId, `produced-${ordinal}.pdf`, at)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) VALUES (?1, ?2, 1, ?3, 'clean', ?4)",
      )
      .bind(versionId, fileId, `files/${versionId}`, at)
      .run();
    made.push(documentId);
    const familyId = ordinal === 1 ? made[0]! : documentId;
    await firmDatabase
      .prepare(
        "INSERT INTO review_document (id, review_set_id, discovery_load_id, record_custodian_id, " +
          "source_kind, file_version_id, family_id, family_role, family_sequence, source_name, " +
          "processing_state, format_identified, extraction_route, sort_date, created_at, " +
          "updated_at) " +
          "VALUES (?1, ?2, ?3, ?4, 'file_version', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
      )
      .bind(
        documentId,
        reviewSetId,
        loadId,
        recordCustodianId,
        versionId,
        familyId,
        ordinal === 0 ? "parent" : ordinal === 1 ? "attachment" : "standalone",
        ordinal === 1 ? 1 : 0,
        `produced-${ordinal}.pdf`,
        ordinal === 2 ? "excepted" : "processed",
        // A processed row always names the format it was read as and the engine that read it — the
        // CHECK holds the first and the write statement holds the second.
        ordinal === 2 ? null : "pdf",
        ordinal === 2 ? null : "discovery-engine",
        sortDate,
        at,
      )
      .run();
  }
  const excepted = made[2]!;
  await firmDatabase
    .prepare(
      "INSERT INTO review_document_exception (id, review_set_id, discovery_load_id, " +
        "review_document_id, stage, code, detail, created_at) VALUES (?1, ?2, ?3, ?4, 'extract', 'encrypted', NULL, ?5)",
    )
    .bind(newIdentifier("reviewDocumentException"), reviewSetId, loadId, excepted, at)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO review_document_occurrence (id, review_set_id, primary_review_document_id, " +
        "duplicate_review_document_id, record_custodian_id, discovery_load_id, created_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(
      newIdentifier("reviewDocumentOccurrence"),
      reviewSetId,
      made[0]!,
      made[2]!,
      recordCustodianId,
      loadId,
      at,
    )
    .run();
  return { familyParent: made[0]!, familyChild: made[1]!, excepted };
}

let corpus: Awaited<ReturnType<typeof seedCorpus>>;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Discovery Read Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("read-owner@example.com", {
    userName: "Read Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Read Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("read-owner@example.com");

  const stranger = await seedCredentialedUser("read-stranger@example.com", {
    userName: "Read Stranger",
    firmId,
  });
  await mirrorMemberWithEveryDiscoveryGrant(firmDatabase, stranger.userId, "Read Stranger");
  strangerCookie = await signInForSessionCookie("read-stranger@example.com");

  const matterResponse = await post("/api/v1/matters", {
    title: "Ridgeway v. Calloway",
    status: "prospective",
    responsibleMemberId: ownerUserId,
  });
  expect(matterResponse.status).toBe(201);
  ({ matterId } = (await matterResponse.json()) as { matterId: string });

  const setResponse = await post(`/api/v1/matters/${matterId}/review-sets`, {
    name: "Plaintiff production",
  });
  expect(setResponse.status).toBe(201);
  ({ id: reviewSetId } = (await setResponse.json()) as { id: string });

  const custodianResponse = await post(`/api/v1/review-sets/${reviewSetId}/record-custodians`, {
    displayName: "A. Ridgeway",
    kind: "person",
  });
  expect(custodianResponse.status).toBe(201);
  ({ id: recordCustodianId } = (await custodianResponse.json()) as { id: string });

  const loadResponse = await post(`/api/v1/review-sets/${reviewSetId}/loads`, {
    lane: "received-production",
    transcriptScope: "exclude",
    declaredDocumentCount: 3,
  });
  expect(loadResponse.status).toBe(201);
  ({ id: loadId } = (await loadResponse.json()) as { id: string });

  corpus = await seedCorpus();
});

describe("the review-document list page", () => {
  it("returns the corpus newest-document-first with the undated document last", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/documents`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; sortDate: string | null }[];
      nextCursor: string | null;
    };
    expect(body.data.map((row) => row.id)).toEqual([
      corpus.familyParent,
      corpus.familyChild,
      corpus.excepted,
    ]);
    expect(body.data.at(-1)?.sortDate).toBeNull();
    expect(body.nextCursor).toBeNull();
  });

  it("walks the whole corpus one document at a time without repeating or dropping one", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let turn = 0; turn < 10; turn += 1) {
      const suffix: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await get(
        `/api/v1/review-sets/${reviewSetId}/documents?pageSize=1${suffix}`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { id: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.data.map((row) => row.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([corpus.familyParent, corpus.familyChild, corpus.excepted]);
  });

  it("filters by family, by processing state, and by exception code", async () => {
    const family = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/documents?familyId=${corpus.familyParent}`)
    ).json()) as { data: { id: string }[] };
    expect(family.data.map((row) => row.id).sort()).toEqual(
      [corpus.familyParent, corpus.familyChild].sort(),
    );

    const excepted = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/documents?processingState=excepted`)
    ).json()) as { data: { id: string }[] };
    expect(excepted.data.map((row) => row.id)).toEqual([corpus.excepted]);

    const encrypted = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/documents?exceptionCode=encrypted`)
    ).json()) as { data: { id: string }[] };
    expect(encrypted.data.map((row) => row.id)).toEqual([corpus.excepted]);
  });

  it("refuses a page size past the cap rather than silently clamping it", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/documents?pageSize=5000`);
    // A caller that asked for five thousand and quietly received two hundred cannot tell that from a
    // corpus with two hundred documents in it.
    expect(response.status).toBe(422);
  });
});

describe("the exception read", () => {
  it("leads with the counts by reason and then lists them", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/exceptions`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      countsByCode: { code: string; documentCount: number }[];
      data: { reviewDocumentId: string; code: string; stage: string }[];
    };
    expect(body.countsByCode).toEqual([{ code: "encrypted", documentCount: 1 }]);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.reviewDocumentId).toBe(corpus.excepted);
    expect(body.data[0]?.stage).toBe("extract");
  });
});

describe("the occurrence read", () => {
  it("names the other copy and the custodian who held it", async () => {
    const response = await get(
      `/api/v1/review-sets/${reviewSetId}/documents/${corpus.familyParent}/occurrences`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { duplicateReviewDocumentId: string; recordCustodianId: string }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.duplicateReviewDocumentId).toBe(corpus.excepted);
    expect(body.data[0]?.recordCustodianId).toBe(recordCustodianId);
  });
});

describe("the index status read", () => {
  it("counts what the corpus still owes the index over its processed documents only", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/index-status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      indexed: number;
      deferred: number;
      failed: number;
      unattempted: number;
    };
    // Two processed documents, nothing asked about yet. The excepted one is not counted: it has no
    // text and never could be indexed, so counting it would report a backlog that can never drain.
    expect(body).toEqual({ indexed: 0, deferred: 0, failed: 0, unattempted: 2 });
  });
});

// THE WALL. Every assertion here is about a member holding all five discovery permissions who is on no
// access list. A 403 anywhere below would be a bug of its own — it would name the corpus.
describe("a member holding every discovery permission but not on the access list", () => {
  it("is told the review set does not exist by every one of the new reads", async () => {
    for (const path of [
      `/api/v1/review-sets/${reviewSetId}/documents`,
      `/api/v1/review-sets/${reviewSetId}/exceptions`,
      `/api/v1/review-sets/${reviewSetId}/documents/${corpus.familyParent}/occurrences`,
      `/api/v1/review-sets/${reviewSetId}/index-status`,
    ]) {
      const response = await get(path, strangerCookie);
      expect(response.status, path).toBe(404);
    }
  });

  it("does not see the review set in the matter's list, and the owner does", async () => {
    const strangerList = (await (
      await get(`/api/v1/matters/${matterId}/review-sets`, strangerCookie)
    ).json()) as { data: { id: string }[] };
    // Not even the NAME. "Plaintiff production" on this matter is itself a disclosure that a
    // production was received.
    expect(strangerList.data).toEqual([]);

    const ownerList = (await (await get(`/api/v1/matters/${matterId}/review-sets`)).json()) as {
      data: { id: string }[];
    };
    expect(ownerList.data.map((row) => row.id)).toEqual([reviewSetId]);
  });

  it("cannot read the review set, its loads, its custodians, or one load by identifier", async () => {
    for (const path of [
      `/api/v1/review-sets/${reviewSetId}`,
      `/api/v1/review-sets/${reviewSetId}/loads`,
      `/api/v1/review-sets/${reviewSetId}/record-custodians`,
      `/api/v1/loads/${loadId}`,
    ]) {
      const response = await get(path, strangerCookie);
      expect(response.status, path).toBe(404);
    }
  });

  it("cannot CLOSE the review set, which would release its derived artifacts", async () => {
    // The gate is not only about reads. Closing a review set marks its extracted text and its
    // metadata sidecars collectable, and there is no path back.
    const response = await post(
      `/api/v1/review-sets/${reviewSetId}/state`,
      { state: "closed" },
      strangerCookie,
    );
    expect(response.status).toBe(404);
    // And it really did not happen.
    const stillOpen = (await (await get(`/api/v1/review-sets/${reviewSetId}`)).json()) as {
      state: string;
    };
    expect(stillOpen.state).toBe("open");
  });

  it("cannot rename the review set or declare a load into it", async () => {
    expect(
      (await patch(`/api/v1/review-sets/${reviewSetId}`, { name: "Renamed" }, strangerCookie))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          `/api/v1/review-sets/${reviewSetId}/loads`,
          { lane: "received-production", transcriptScope: "exclude", declaredDocumentCount: 1 },
          strangerCookie,
        )
      ).status,
    ).toBe(404);
    const unchanged = (await (await get(`/api/v1/review-sets/${reviewSetId}`)).json()) as {
      name: string;
    };
    expect(unchanged.name).toBe("Plaintiff production");
  });
});
