import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { BOARD_WRITES_KEY, WRITES_DISABLED_VALUE } from "@magna-carta/community/availability";
import {
  applyControlPlaneMigrations,
  makeOperator,
  markAsPortalClient,
  seedMember,
  FIRM_ONE,
  FIRM_THREE,
  FIRM_TWO,
  type SeededMember,
} from "./support.ts";

const BASE = "https://community.magnacarta.esq";

let author: SeededMember;
let reader: SeededMember;
let third: SeededMember;
let operator: SeededMember;

async function post(path: string, body: unknown, member?: SeededMember): Promise<Response> {
  return await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(member === undefined ? {} : { cookie: member.cookie }),
    },
    body: JSON.stringify(body ?? {}),
  });
}

async function request(
  method: string,
  path: string,
  member?: SeededMember,
  body?: unknown,
): Promise<Response> {
  return await SELF.fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(member === undefined ? {} : { cookie: member.cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const GOOD_POST = {
  kind: "request" as const,
  category: "matters_and_organisation" as const,
  title: "Bulk editing custom fields on closed matters",
  body: "Changing one picklist option across several hundred closed matters currently means reopening each one.",
};

async function createPublishedPost(member: SeededMember): Promise<number> {
  const created = await post("/api/v1/community/posts", GOOD_POST, member);
  const body = (await created.json()) as { number: number };
  if (created.status === 202) {
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(member)}/approve`,
      {},
      operator,
    );
  }
  return body.number;
}

async function profileOf(member: SeededMember): Promise<string> {
  const row = await env.DB_CONTROL.prepare(`SELECT id FROM community_profile WHERE user_id = ?1`)
    .bind(member.userId)
    .first<{ id: string }>();
  return row?.id ?? "";
}

// A fresh cast for every test. The rate limiter's counters live in the worker isolate and outlive
// a single test, so reusing one account across the file would make the limiter — not the behaviour
// under test — decide the outcome. Distinct accounts at distinct firms also keep the distinct-firm
// arithmetic honest, which several of these tests are about.
let castCounter = 0;

beforeEach(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  for (const table of [
    "community_moderation_action",
    "community_flag",
    "community_vote",
    "community_comment",
    "community_post_number_allocation",
    "community_post",
    "community_post_number_counter",
    "community_profile",
    "platform_operator",
    "session",
    "user",
  ]) {
    await env.DB_CONTROL.prepare(`DELETE FROM ${table}`).run();
  }
  await env.COMMUNITY_KV.delete(BOARD_WRITES_KEY);
  await env.COMMUNITY_KV.delete("community:writes:notice");
  castCounter += 1;
  author = await seedMember(env.DB_CONTROL, {
    userId: `user_boardAuthor${castCounter}`,
    firmId: `${FIRM_ONE}${castCounter}`,
    name: "Marilyn Veitch",
  });
  reader = await seedMember(env.DB_CONTROL, {
    userId: `user_boardReader${castCounter}`,
    firmId: `${FIRM_TWO}${castCounter}`,
    name: "Hallam Pryce",
  });
  third = await seedMember(env.DB_CONTROL, {
    userId: `user_boardThird${castCounter}`,
    firmId: `${FIRM_THREE}${castCounter}`,
    name: "Delia Okonkwo",
  });
  operator = await seedMember(env.DB_CONTROL, {
    userId: `user_boardOperator${castCounter}`,
    firmId: `${FIRM_ONE}${castCounter}`,
    name: "Platform team",
  });
  await makeOperator(env.DB_CONTROL, operator.userId);
});

describe("reading the board", () => {
  it("serves the category list without a session, and offers no catch-all", async () => {
    const response = await SELF.fetch(`${BASE}/api/v1/community/categories`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { key: string }[] };
    expect(body.data.length).toBeGreaterThan(10);
    expect(body.data.map((entry) => entry.key)).not.toContain("general");
  });

  it("asks every crawler not to index anything, on every response", async () => {
    for (const path of ["/api/v1/community/categories", "/api/v1/community/posts", "/nope"]) {
      const response = await SELF.fetch(`${BASE}${path}`);
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
  });

  it("serves an empty board rather than refusing when nothing has been posted", async () => {
    const response = await SELF.fetch(`${BASE}/api/v1/community/posts`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [], nextCursor: null });
  });
});

describe("writing needs a signed-in member of a provisioned firm", () => {
  it("refuses an anonymous post with the unauthenticated problem", async () => {
    const response = await post("/api/v1/community/posts", GOOD_POST);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as { type: string };
    expect(body.type).toContain("unauthenticated");
  });

  it("refuses an account whose email is not confirmed", async () => {
    const unconfirmed = await seedMember(env.DB_CONTROL, {
      userId: `user_boardUnconfirmed${castCounter}`,
      firmId: `${FIRM_TWO}${castCounter}`,
      name: "Not Confirmed",
      emailVerified: false,
    });
    const response = await post("/api/v1/community/posts", GOOD_POST, unconfirmed);
    expect(response.status).toBe(403);
  });

  it("refuses a firm's own client, whose account exists because a firm invited them", async () => {
    const portalClient = await seedMember(env.DB_CONTROL, {
      userId: `user_boardPortalClient${castCounter}`,
      firmId: `${FIRM_TWO}${castCounter}`,
      name: "A Client Of The Firm",
    });
    await markAsPortalClient(env.DB_CONTROL, {
      userId: portalClient.userId,
      firmId: portalClient.firmId,
    });
    const response = await post("/api/v1/community/posts", GOOD_POST, portalClient);
    expect(response.status).toBe(403);
    // Refused before a board identity exists at all, so nothing about this account can be rendered
    // later. Publishing that a named person is a client of a named firm is the sharpest disclosure
    // this surface could make.
    const profile = await env.DB_CONTROL.prepare(
      `SELECT id FROM community_profile WHERE user_id = ?1`,
    )
      .bind(portalClient.userId)
      .first<{ id: string }>();
    expect(profile).toBeNull();
  });

  it("refuses an expired session", async () => {
    const expired = await seedMember(env.DB_CONTROL, {
      userId: `user_boardExpired${castCounter}`,
      firmId: `${FIRM_TWO}${castCounter}`,
      name: "Expired",
      expiresAt: Date.parse("2020-01-01T00:00:00.000Z"),
    });
    const response = await post("/api/v1/community/posts", GOOD_POST, expired);
    expect(response.status).toBe(401);
  });

  it("holds a brand-new account's first post rather than publishing it", async () => {
    const response = await post("/api/v1/community/posts", GOOD_POST, author);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { heldReason: string; number: number };
    expect(body.heldReason).toBe("first_write_review");
    const listed = await SELF.fetch(`${BASE}/api/v1/community/posts`);
    expect((await listed.json()) as { data: unknown[] }).toEqual({ data: [], nextCursor: null });
  });

  it("publishes freely once an operator has approved the account once", async () => {
    await post("/api/v1/community/posts", GOOD_POST, author);
    const approve = await post(
      `/api/v1/community/moderation/profiles/${await profileOf(author)}/approve`,
      {},
      operator,
    );
    expect(approve.status).toBe(204);
    const second = await post(
      "/api/v1/community/posts",
      { ...GOOD_POST, title: "A second request about the same area" },
      author,
    );
    expect(second.status).toBe(201);
    const listed = await SELF.fetch(`${BASE}/api/v1/community/posts`);
    const body = (await listed.json()) as { data: { title: string }[] };
    // Both the held one and the new one are visible: approving publishes what was waiting.
    expect(body.data).toHaveLength(2);
  });

  it("refuses a post with no category, because the category is the question that reframes the post", async () => {
    const response = await post(
      "/api/v1/community/posts",
      { kind: "request", title: GOOD_POST.title, body: GOOD_POST.body },
      author,
    );
    expect(response.status).toBe(422);
  });
});

describe("the confidentiality posture", () => {
  beforeEach(async () => {
    await post("/api/v1/community/posts", GOOD_POST, author);
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(author)}/approve`,
      {},
      operator,
    );
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(reader)}/approve`,
      {},
      operator,
    );
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(third)}/approve`,
      {},
      operator,
    );
  });

  it("hides a post carrying a client-shaped signal, and says which signal without repeating it", async () => {
    const response = await post(
      "/api/v1/community/posts",
      {
        ...GOOD_POST,
        title: "Trust reversal on Henderson v. Whitmore",
        body: "The reversal on this matter posted to the wrong ledger and I cannot correct it.",
      },
      author,
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { heldReason: string; signals: string[] };
    expect(body.heldReason).toBe("confidentiality_detector");
    expect(body.signals).toContain("case_caption");
    // The names of the signals, never the text that matched them.
    expect(JSON.stringify(body)).not.toContain("Henderson");
  });

  it("records the automatic hide with no actor", async () => {
    await post(
      "/api/v1/community/posts",
      {
        ...GOOD_POST,
        title: "Docket import dropped a case",
        body: "The import silently dropped 1:24-cv-00123 and reported success.",
      },
      author,
    );
    const action = await env.DB_CONTROL.prepare(
      `SELECT action, actor_user_id, reason FROM community_moderation_action ORDER BY created_at DESC LIMIT 1`,
    ).first<{ action: string; actor_user_id: string | null; reason: string | null }>();
    expect(action?.action).toBe("hidden");
    // Null actor is how the record says the platform acted on its own at three in the morning.
    expect(action?.actor_user_id).toBeNull();
    expect(action?.reason).toContain("matter_or_docket_number");
  });

  it("hides a post on a single confidentiality report from any signed-in reader", async () => {
    const number = await createPublishedPost(author);
    const reported = await post(
      `/api/v1/community/posts/${number}/reports`,
      { reason: "confidentiality" },
      reader,
    );
    expect(reported.status).toBe(200);
    expect(await reported.json()).toEqual({ hidden: true });
    const fetched = await SELF.fetch(`${BASE}/api/v1/community/posts/${number}`);
    // Absent, not marked. A placeholder over a suspected disclosure points straight at it.
    expect(fetched.status).toBe(404);
  });

  it("does not hide on one spam report, and does once several separate firms agree", async () => {
    const number = await createPublishedPost(author);
    const first = await post(
      `/api/v1/community/posts/${number}/reports`,
      { reason: "spam" },
      reader,
    );
    expect(await first.json()).toEqual({ hidden: false });
    const second = await post(
      `/api/v1/community/posts/${number}/reports`,
      { reason: "spam" },
      third,
    );
    expect(await second.json()).toEqual({ hidden: false });
    const byOperatorsFirm = await post(
      `/api/v1/community/posts/${number}/reports`,
      { reason: "spam" },
      operator,
    );
    // Three distinct firms have now reported it, which is the threshold.
    expect(await byOperatorsFirm.json()).toEqual({ hidden: true });
  });

  it("deletes an author's own post in one call, with no operator in the path", async () => {
    const number = await createPublishedPost(author);
    const deleted = await request("DELETE", `/api/v1/community/posts/${number}`, author);
    expect(deleted.status).toBe(204);
    const stored = await env.DB_CONTROL.prepare(
      `SELECT title, body, visibility FROM community_post WHERE number = ?1`,
    )
      .bind(number)
      .first<{ title: string; body: string; visibility: string }>();
    expect(stored?.title).toBe("");
    expect(stored?.body).toBe("");
    expect(stored?.visibility).toBe("deleted_by_author");
  });

  it("does not let one member delete another's post", async () => {
    const number = await createPublishedPost(author);
    const deleted = await request("DELETE", `/api/v1/community/posts/${number}`, reader);
    expect(deleted.status).toBe(404);
  });

  it("restores a hidden post and marks the reports that hid it as cleared", async () => {
    const number = await createPublishedPost(author);
    await post(`/api/v1/community/posts/${number}/reports`, { reason: "confidentiality" }, reader);
    const restored = await post(`/api/v1/community/posts/${number}/restore`, {}, operator);
    expect(restored.status).toBe(204);
    const fetched = await SELF.fetch(`${BASE}/api/v1/community/posts/${number}`);
    expect(fetched.status).toBe(200);
    const flag = await env.DB_CONTROL.prepare(`SELECT status FROM community_flag LIMIT 1`).first<{
      status: string;
    }>();
    expect(flag?.status).toBe("cleared");
  });
});

describe("what a reader learns", () => {
  beforeEach(async () => {
    await post("/api/v1/community/posts", GOOD_POST, author);
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(author)}/approve`,
      {},
      operator,
    );
  });

  it("returns no firm and no account handle anywhere in a post", async () => {
    const listed = await SELF.fetch(`${BASE}/api/v1/community/posts`);
    const text = await listed.text();
    expect(text).not.toContain(author.firmId);
    expect(text).not.toContain(author.userId);
    expect(text).toContain("Marilyn Veitch");
  });

  it("withholds the distinct-firm count until enough firms are represented", async () => {
    const number = (
      (await (await SELF.fetch(`${BASE}/api/v1/community/posts`)).json()) as {
        data: { number: number }[];
      }
    ).data[0]?.number;
    expect(number).toBeDefined();
    await post(`/api/v1/community/posts/${number}/vote`, {}, reader);
    const fetched = await SELF.fetch(`${BASE}/api/v1/community/posts/${number}`);
    const body = (await fetched.json()) as Record<string, unknown>;
    expect(body["voteCount"]).toBe(1);
    expect(body["distinctFirmVoteCount"]).toBeUndefined();
  });
});

describe("the read-only kill switch", () => {
  it("refuses every write and leaves every read working", async () => {
    await env.COMMUNITY_KV.put(BOARD_WRITES_KEY, WRITES_DISABLED_VALUE);
    const write = await post("/api/v1/community/posts", GOOD_POST, author);
    expect(write.status).toBe(503);
    const body = (await write.json()) as { type: string; refusalNotice?: string };
    expect(body.type).toContain("community-board-read-only");
    expect(body.refusalNotice).toBeDefined();

    const read = await SELF.fetch(`${BASE}/api/v1/community/categories`);
    expect(read.status).toBe(200);
  });

  it("carries the operator's own notice when one is set", async () => {
    await env.COMMUNITY_KV.put(BOARD_WRITES_KEY, WRITES_DISABLED_VALUE);
    await env.COMMUNITY_KV.put(
      "community:writes:notice",
      "Paused while we work through a backlog.",
    );
    const write = await post("/api/v1/community/posts", GOOD_POST, author);
    const body = (await write.json()) as { refusalNotice?: string };
    expect(body.refusalNotice).toBe("Paused while we work through a backlog.");
  });
});

describe("moderation is a platform axis, not a firm one", () => {
  it("answers a member probing the moderation surface with a 404, not a 403", async () => {
    const response = await SELF.fetch(`${BASE}/api/v1/community/moderation/queue`, {
      headers: { cookie: author.cookie },
    });
    // A 403 would confirm the surface exists to somebody who should not know.
    expect(response.status).toBe(404);
  });

  it("gives an operator the queue, confidentiality first", async () => {
    const number = await createPublishedPost(author);
    await post(`/api/v1/community/posts/${number}/reports`, { reason: "confidentiality" }, reader);
    const response = await SELF.fetch(`${BASE}/api/v1/community/moderation/queue`, {
      headers: { cookie: operator.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reports: { reason: string }[] };
    expect(body.reports[0]?.reason).toBe("confidentiality");
  });

  it("refuses to decline a request without a reason and a note", async () => {
    const number = await createPublishedPost(author);
    const bare = await post(
      `/api/v1/community/posts/${number}/status`,
      { status: "not_on_the_roadmap" },
      operator,
    );
    expect(bare.status).toBe(422);
    const reasoned = await post(
      `/api/v1/community/posts/${number}/status`,
      {
        status: "not_on_the_roadmap",
        declineReason: "already_possible",
        declineNote: "The closed-matters view already offers a bulk edit.",
      },
      operator,
    );
    expect(reasoned.status).toBe(204);
  });

  it("refuses to give a question a status", async () => {
    const created = await post(
      "/api/v1/community/posts",
      { ...GOOD_POST, kind: "question", title: "How do I bulk edit closed matters?" },
      reader,
    );
    const { number } = (await created.json()) as { number: number };
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(reader)}/approve`,
      {},
      operator,
    );
    const response = await post(
      `/api/v1/community/posts/${number}/status`,
      { status: "planned" },
      operator,
    );
    expect(response.status).toBe(404);
  });

  it("converts a question into a request and carries its thread", async () => {
    const created = await post(
      "/api/v1/community/posts",
      { ...GOOD_POST, kind: "question", title: "How do I bulk edit closed matters?" },
      reader,
    );
    const { number } = (await created.json()) as { number: number };
    // A profile exists only once an account has written, so approval comes after the first write
    // rather than before it — which is the order a real first post takes too.
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(reader)}/approve`,
      {},
      operator,
    );
    await post(
      `/api/v1/community/posts/${number}/comments`,
      { body: "There is no way to do this today." },
      author,
    );
    await post(
      `/api/v1/community/moderation/profiles/${await profileOf(author)}/approve`,
      {},
      operator,
    );
    const converted = await post(
      `/api/v1/community/posts/${number}/convert-to-request`,
      {},
      operator,
    );
    expect(converted.status).toBe(204);
    const fetched = await SELF.fetch(`${BASE}/api/v1/community/posts/${number}`);
    const body = (await fetched.json()) as { kind: string; commentCount: number };
    expect(body.kind).toBe("request");
    expect(body.commentCount).toBe(1);
  });
});

describe("the roadmap", () => {
  it("is a projection of the board and carries no dates", async () => {
    const number = await createPublishedPost(author);
    await post(`/api/v1/community/posts/${number}/status`, { status: "planned" }, operator);
    const response = await SELF.fetch(`${BASE}/api/v1/community/roadmap`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      columns: { status: string; data: Record<string, unknown>[] }[];
    };
    expect(body.columns.map((column) => column.status)).toEqual([
      "planned",
      "building_now",
      "beta",
    ]);
    const [planned] = body.columns;
    expect(planned?.data).toHaveLength(1);
    for (const card of planned?.data ?? []) {
      // No target date exists anywhere, because there is no column to hold one. A nullable date
      // column gets populated, and then it is a promise.
      expect(Object.keys(card)).not.toContain("targetDate");
      expect(Object.keys(card)).not.toContain("dueAt");
    }
  });
});
