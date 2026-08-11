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

// The coding surface through the chokepoint over real Miniflare bindings, and above all the WALL:
// holding every discovery permission is not the same as being on a review set's access list, and a
// corpus you are not listed on is ABSENT rather than refused.
//
// This block seeds its OWN firm — the chokepoint's rate-limit key is `firm:<firmId>`, so sharing one
// with another block would spend its window and start collecting 429s.

let firmId: FirmId;
let ownerCookie: string;
let strangerCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerUserId: UserId;
let strangerUserId: UserId;
let matterId: string;
let reviewSetId: string;

const clock = { now: () => new Date().toISOString() };

// A member holding EVERY discovery permission and on no review set's access list. This is the second
// half of the access rule made testable: the first half (a discovery grant is required) shipped with
// the review-set model; this half is that the grant is not sufficient.
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

async function put(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, crypto.randomUUID()),
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

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Discovery Coding Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("coding-owner@example.com", {
    userName: "Coding Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Coding Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("coding-owner@example.com");

  const stranger = await seedCredentialedUser("coding-stranger@example.com", {
    userName: "Coding Stranger",
    firmId,
  });
  await mirrorMemberWithEveryDiscoveryGrant(firmDatabase, stranger.userId, "Coding Stranger");
  strangerUserId = stranger.userId;
  strangerCookie = await signInForSessionCookie("coding-stranger@example.com");

  const matterResponse = await post("/api/v1/matters", {
    title: "Ellery v. Bramwell",
    status: "prospective",
    responsibleMemberId: ownerUserId,
  });
  expect(matterResponse.status).toBe(201);
  ({ matterId } = (await matterResponse.json()) as { matterId: string });

  const setResponse = await post(`/api/v1/matters/${matterId}/review-sets`, {
    name: "Our collection",
  });
  expect(setResponse.status).toBe(201);
  ({ id: reviewSetId } = (await setResponse.json()) as { id: string });
});

describe("creating a review set seeds its panel and its access list", () => {
  it("seeds the three system questions with the meanings the machine reads", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`);
    expect(response.status).toBe(200);
    const panel = (await response.json()) as {
      groups: { name: string; kind: string; cardinality: string }[];
      tags: { semantic: string | null }[];
    };
    expect(panel.groups.map((group) => group.name)).toEqual([
      "Responsiveness",
      "Privilege",
      "Confidentiality",
    ]);
    expect(panel.groups.every((group) => group.kind === "system")).toBe(true);
    const semantics = panel.tags.map((tag) => tag.semantic).filter((value) => value !== null);
    expect(semantics).toContain("responsive");
    expect(semantics).toContain("privileged");
  });

  it("puts the creating member on the access list, and nobody else", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/access`);
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { memberUserId: string }[] };
    expect(data.map((member) => member.memberUserId)).toEqual([ownerUserId]);
  });
});

// THE WALL. Every assertion here is about a member who holds all five discovery permissions and is
// on no access list. A 403 anywhere below would be a bug of its own — it would name the corpus.
describe("a member holding every discovery permission but not on the access list", () => {
  it("cannot read the coding panel, and is told the review set does not exist", async () => {
    const response = await get(
      `/api/v1/review-sets/${reviewSetId}/coding-panel`,
      strangerCookie,
    );
    expect(response.status).toBe(404);
  });

  it("cannot read the access list, the history, or the progress", async () => {
    for (const path of [
      `/api/v1/review-sets/${reviewSetId}/access`,
      `/api/v1/review-sets/${reviewSetId}/coding/acts`,
      `/api/v1/review-sets/${reviewSetId}/coding/progress`,
    ]) {
      expect((await get(path, strangerCookie)).status, path).toBe(404);
    }
  });

  it("cannot add themselves to the list", async () => {
    const response = await put(
      `/api/v1/review-sets/${reviewSetId}/access/${strangerUserId}`,
      strangerCookie,
    );
    expect(response.status).toBe(404);
    // And the list did not move.
    const listed = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/access`)
    ).json()) as { data: { memberUserId: string }[] };
    expect(listed.data.map((member) => member.memberUserId)).toEqual([ownerUserId]);
  });

  it("cannot add a coding question", async () => {
    const response = await post(
      `/api/v1/review-sets/${reviewSetId}/coding-panel/questions`,
      { name: "Smuggled in", cardinality: "multi" },
      strangerCookie,
    );
    expect(response.status).toBe(404);
  });

  it("sees the corpus once somebody on the list adds them, and loses it again on revoke", async () => {
    expect((await put(`/api/v1/review-sets/${reviewSetId}/access/${strangerUserId}`)).status).toBe(
      204,
    );
    expect(
      (await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`, strangerCookie)).status,
    ).toBe(200);

    expect(
      (await remove(`/api/v1/review-sets/${reviewSetId}/access/${strangerUserId}`)).status,
    ).toBe(204);
    expect(
      (await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`, strangerCookie)).status,
    ).toBe(404);
  });

  it("granting somebody already listed is a no-op rather than a conflict", async () => {
    expect((await put(`/api/v1/review-sets/${reviewSetId}/access/${ownerUserId}`)).status).toBe(204);
    const listed = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/access`)
    ).json()) as { data: unknown[] };
    expect(listed.data).toHaveLength(1);
  });

  it("refuses to remove the last member on the list", async () => {
    const response = await remove(`/api/v1/review-sets/${reviewSetId}/access/${ownerUserId}`);
    // A list that could reach empty is a corpus that could become permanently unreachable, because
    // the list is fail-closed.
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("discovery-access-list-would-be-empty");
  });
});

describe("the coding panel", () => {
  it("adds a firm's own question and an answer under it, and the answer drives no machinery", async () => {
    const questionResponse = await post(
      `/api/v1/review-sets/${reviewSetId}/coding-panel/questions`,
      { name: "Issue codes", cardinality: "multi" },
    );
    expect(questionResponse.status).toBe(201);
    const { id: questionId } = (await questionResponse.json()) as { id: string };

    const tagResponse = await post(
      `/api/v1/review-sets/${reviewSetId}/coding-panel/questions/${questionId}/tags`,
      { name: "Notice", colorToken: "status-info" },
    );
    expect(tagResponse.status).toBe(201);

    const panel = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`)
    ).json()) as { tags: { name: string; semantic: string | null }[] };
    const created = panel.tags.find((tag) => tag.name === "Notice");
    // A tag a firm created carries NO meaning, so a renamed label can never change what a production
    // withholds.
    expect(created?.semantic).toBeNull();
  });

  it("refuses a colour that is a value rather than a design-token name", async () => {
    const questionResponse = await post(
      `/api/v1/review-sets/${reviewSetId}/coding-panel/questions`,
      { name: "Themes", cardinality: "multi" },
    );
    expect(questionResponse.status).toBe(201);
    const { id: questionId } = (await questionResponse.json()) as { id: string };
    const response = await post(
      `/api/v1/review-sets/${reviewSetId}/coding-panel/questions/${questionId}/tags`,
      { name: "Hot", colorToken: "#ff0000" },
    );
    expect(response.status).toBe(422);
  });

  it("refuses to deactivate a tag whose meaning production resolves through", async () => {
    const panel = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`)
    ).json()) as { tags: { id: string; semantic: string | null }[] };
    const privileged = panel.tags.find((tag) => tag.semantic === "privileged");
    expect(privileged).toBeDefined();
    const response = await SELF.fetch(
      `https://example.com/api/v1/review-sets/${reviewSetId}/coding-panel/tags/${privileged?.id}`,
      {
        method: "PATCH",
        headers: authHeaders(ownerCookie, crypto.randomUUID()),
        body: JSON.stringify({ active: false }),
      },
    );
    expect(response.status).toBe(422);
  });

  it("renames a seeded question freely, because nothing matches it by name", async () => {
    const panel = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`)
    ).json()) as { groups: { id: string; name: string }[] };
    const privilege = panel.groups.find((group) => group.name === "Privilege");
    const response = await SELF.fetch(
      `https://example.com/api/v1/review-sets/${reviewSetId}/coding-panel/questions/${privilege?.id}`,
      {
        method: "PATCH",
        headers: authHeaders(ownerCookie, crypto.randomUUID()),
        body: JSON.stringify({ name: "Withholding" }),
      },
    );
    expect(response.status).toBe(204);
    const after = (await (
      await get(`/api/v1/review-sets/${reviewSetId}/coding-panel`)
    ).json()) as { groups: { name: string }[]; tags: { semantic: string | null }[] };
    expect(after.groups.map((group) => group.name)).toContain("Withholding");
    // The meanings are untouched — that is the whole point of renaming being free.
    expect(after.tags.some((tag) => tag.semantic === "privileged")).toBe(true);
  });
});

describe("progress on an empty corpus", () => {
  it("reports zeroes rather than failing, and names no families", async () => {
    const response = await get(`/api/v1/review-sets/${reviewSetId}/coding/progress`);
    expect(response.status).toBe(200);
    const progress = (await response.json()) as {
      documentCount: number;
      completedCount: number;
      uncodedDocumentIds: string[];
      splitFamilyIds: string[];
    };
    expect(progress.documentCount).toBe(0);
    expect(progress.completedCount).toBe(0);
    expect(progress.uncodedDocumentIds).toEqual([]);
    expect(progress.splitFamilyIds).toEqual([]);
  });
});
