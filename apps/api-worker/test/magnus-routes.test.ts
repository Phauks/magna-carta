import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { MAGNUS_DISCLOSURE_VERSION } from "@magna-carta/magnus/disclosure";
import { MEMBER_TURN_MAX_BYTES } from "@magna-carta/magnus/limits";
import {
  magnusDailyTurnCeilingDefinition,
  magnusEnabledDefinition,
} from "@magna-carta/magnus/settings";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import type { ProblemBody } from "../src/http/contracts/problem.ts";

// The Magnus route surface driven through the chokepoint over real Miniflare bindings.
//
// The load-bearing assertions here are the refusals: every route refuses while the firm has not
// opened both consent gates, and it says WHICH gate is closed. The happy paths only exist once the
// firm has opted in, which is exactly the shape a firm sees.

let firmId: FirmId;
let ownerCookie: string;
let attorneyCookie: string;
let attorneyUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

async function writeSetting<T>(
  definition: Parameters<typeof writeFirmSettingStatement<T>>[1],
  value: T,
): Promise<void> {
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [writeFirmSettingStatement(firmDatabase, definition, value, clock.now())],
      outboxMessages: [],
    },
    { now: clock.now },
  );
}

async function openBothGates(): Promise<void> {
  await writeSetting(aiProcessingEligibilityDefinition, true);
  await writeSetting(magnusEnabledDefinition, true);
}

async function closeFeatureGate(): Promise<void> {
  await writeSetting(magnusEnabledDefinition, false);
}

async function closeFirmGate(): Promise<void> {
  await writeSetting(aiProcessingEligibilityDefinition, false);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Magnus Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("magnus-owner@example.com", {
    userName: "Magnus Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Magnus Owner", firmId);
  ownerCookie = await signInForSessionCookie("magnus-owner@example.com");

  // A second member holding magnus:converse but NOT magnus:readAllConversations, so the
  // administrative-read branch can be tested from both sides.
  const attorney = await seedCredentialedUser("magnus-attorney@example.com", {
    userName: "Magnus Attorney",
    firmId,
  });
  attorneyUserId = attorney.userId;
  await insertMemberStatement(firmDatabase, {
    userId: attorney.userId,
    displayName: "Magnus Attorney",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), attorney.userId, "magnus:converse", clock.now())
    .run();
  attorneyCookie = await signInForSessionCookie("magnus-attorney@example.com");
});

function headers(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function post(path: string, body: unknown, cookie = ownerCookie, idempotencyKey?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
  });
}

async function remove(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: headers(cookie, true),
  });
}

async function acknowledgeFor(cookie: string): Promise<void> {
  const response = await post("/api/v1/magnus/acknowledgement", {}, cookie);
  expect(response.status).toBe(200);
}

async function startConversation(cookie = ownerCookie): Promise<string> {
  const response = await post("/api/v1/magnus/conversations", { title: "A conversation" }, cookie);
  expect(response.status).toBe(201);
  return (await readJson<{ id: string }>(response)).id;
}

describe("a firm that has not opted in", () => {
  it("refuses EVERY route, naming the general gate first", async () => {
    await closeFirmGate();
    await closeFeatureGate();

    const availability = await get("/api/v1/magnus/availability");
    expect(availability.status).toBe(200);
    expect(await availability.json()).toEqual({ state: "firm-ineligible" });

    const routes: Array<[string, Promise<Response>]> = [
      ["start", post("/api/v1/magnus/conversations", { title: "x" })],
      ["list", get("/api/v1/magnus/conversations")],
      ["get", get(`/api/v1/magnus/conversations/${newIdentifier("magnusConversation")}`)],
      [
        "rename",
        patch(`/api/v1/magnus/conversations/${newIdentifier("magnusConversation")}`, {
          title: "x",
        }),
      ],
      ["delete", remove(`/api/v1/magnus/conversations/${newIdentifier("magnusConversation")}`)],
      [
        "submit",
        post(`/api/v1/magnus/conversations/${newIdentifier("magnusConversation")}/turns`, {
          content: "hello",
        }),
      ],
      [
        "poll",
        get(
          `/api/v1/magnus/conversations/${newIdentifier("magnusConversation")}/turns/${newIdentifier("magnusTurn")}`,
        ),
      ],
      ["events", get(`/api/v1/magnus/conversations/${newIdentifier("magnusConversation")}/events`)],
    ];
    for (const [label, pending] of routes) {
      const response = await pending;
      expect(`${label}:${response.status}`).toBe(`${label}:403`);
      const problem = (await response.json()) as { type: string };
      expect(problem.type).toContain("magnus-firm-not-eligible");
    }
  });

  it("names the FEATURE gate when the general one is open and the feature is not", async () => {
    await writeSetting(aiProcessingEligibilityDefinition, true);
    await closeFeatureGate();

    const availability = await get("/api/v1/magnus/availability");
    expect(await availability.json()).toEqual({ state: "feature-disabled" });

    const start = await post("/api/v1/magnus/conversations", { title: "x" });
    expect(start.status).toBe(403);
    expect((await readJson<ProblemBody>(start)).type).toContain("magnus-not-enabled");
  });

  it("refuses a member who has not accepted the disclosure, with a 409 they can clear themselves", async () => {
    await openBothGates();
    const availability = await get("/api/v1/magnus/availability", attorneyCookie);
    expect(await availability.json()).toMatchObject({
      state: "acknowledgement-required",
      disclosureVersion: MAGNUS_DISCLOSURE_VERSION,
    });

    const start = await post("/api/v1/magnus/conversations", { title: "x" }, attorneyCookie);
    expect(start.status).toBe(409);
    expect((await readJson<ProblemBody>(start)).type).toContain("magnus-acknowledgement-required");
  });
});

describe("an opted-in firm", () => {
  beforeAll(async () => {
    await openBothGates();
    await acknowledgeFor(ownerCookie);
    await acknowledgeFor(attorneyCookie);
  });

  it("reports availability with the disclosure version and the remaining allowance", async () => {
    const response = await get("/api/v1/magnus/availability");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      state: string;
      disclosureVersion: number;
      remainingDailyTurns: number;
    };
    expect(body.state).toBe("open");
    expect(body.disclosureVersion).toBe(MAGNUS_DISCLOSURE_VERSION);
    expect(body.remainingDailyTurns).toBeGreaterThan(0);
  });

  it("re-accepting the same disclosure version is a no-op that still answers 200", async () => {
    const again = await post("/api/v1/magnus/acknowledgement", {});
    expect(again.status).toBe(200);
    const { results } = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM magnus_member_acknowledgement")
      .all<{ total: number }>();
    // One row per member, never one per acceptance.
    expect(results[0]?.total).toBe(2);
  });

  it("starts, lists, renames, and deletes a conversation", async () => {
    const conversationId = await startConversation();
    expect(conversationId).toMatch(/^magnusConversation_/);

    const list = await get("/api/v1/magnus/conversations");
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      data: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(listed.data.some((row) => row.id === conversationId)).toBe(true);

    const renamed = await patch(`/api/v1/magnus/conversations/${conversationId}`, {
      title: "Renamed",
    });
    expect(renamed.status).toBe(200);

    const deleted = await remove(`/api/v1/magnus/conversations/${conversationId}`);
    expect(deleted.status).toBe(200);

    const afterDelete = await get(`/api/v1/magnus/conversations/${conversationId}`);
    expect(afterDelete.status).toBe(404);
  });

  it("submits a turn, writing the pair and returning a pending answer", async () => {
    const conversationId = await startConversation();
    const response = await post(`/api/v1/magnus/conversations/${conversationId}/turns`, {
      content: "can I still amend before the pretrial order",
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      conversationId: string;
      memberTurnId: string;
      magnusTurnId: string;
      status: string;
    };
    expect(body.status).toBe("pending");
    expect(body.memberTurnId).toMatch(/^magnusTurn_/);

    const poll = await get(
      `/api/v1/magnus/conversations/${conversationId}/turns/${body.magnusTurnId}`,
    );
    expect(poll.status).toBe(200);
    expect(await poll.json()).toMatchObject({ status: "pending" });
  });

  it("a replayed Idempotency-Key returns the first result and creates no second turn", async () => {
    const conversationId = await startConversation();
    const key = crypto.randomUUID();
    const first = await post(
      `/api/v1/magnus/conversations/${conversationId}/turns`,
      { content: "the same question" },
      ownerCookie,
      key,
    );
    expect(first.status).toBe(202);
    const firstBody = await first.json();

    const replay = await post(
      `/api/v1/magnus/conversations/${conversationId}/turns`,
      { content: "the same question" },
      ownerCookie,
      key,
    );
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual(firstBody);

    const { results } = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM magnus_turn WHERE conversation_id = ?1")
      .bind(conversationId)
      .all<{ total: number }>();
    expect(results[0]?.total).toBe(2);
  });

  it("refuses an over-cap message naming the limit, and enqueues nothing", async () => {
    const conversationId = await startConversation();
    const response = await post(`/api/v1/magnus/conversations/${conversationId}/turns`, {
      content: "x".repeat(MEMBER_TURN_MAX_BYTES + 1),
    });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string; detail: string };
    expect(problem.type).toContain("magnus-turn-too-large");
    expect(problem.detail).toContain(String(MEMBER_TURN_MAX_BYTES));

    const { results } = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM magnus_turn WHERE conversation_id = ?1")
      .bind(conversationId)
      .all<{ total: number }>();
    expect(results[0]?.total).toBe(0);
  });

  it("refuses once the firm's daily allowance is spent, naming the ceiling", async () => {
    const conversationId = await startConversation();
    await writeSetting(magnusDailyTurnCeilingDefinition, 0);
    const response = await post(`/api/v1/magnus/conversations/${conversationId}/turns`, {
      content: "one more",
    });
    expect(response.status).toBe(429);
    expect((await readJson<ProblemBody>(response)).type).toContain("magnus-daily-ceiling-reached");
    await writeSetting(magnusDailyTurnCeilingDefinition, 500);
  });

  it("a member cannot read another member's conversation without the administrative permission", async () => {
    const ownerConversation = await startConversation(ownerCookie);
    const refused = await get(`/api/v1/magnus/conversations/${ownerConversation}`, attorneyCookie);
    // Reported as absent, not forbidden: a member has no business learning that another member's
    // conversation exists.
    expect(refused.status).toBe(404);
  });

  it("an administrative read succeeds AND writes an audit row naming the author", async () => {
    const attorneyConversation = await startConversation(attorneyCookie);
    const before = await auditCount("magnus.conversation_read_by_administrator");

    const read = await get(`/api/v1/magnus/conversations/${attorneyConversation}`, ownerCookie);
    expect(read.status).toBe(200);

    expect(await auditCount("magnus.conversation_read_by_administrator")).toBe(before + 1);
    const { results } = await firmDatabase
      .prepare(
        "SELECT metadata FROM audit_log WHERE event = ?1 AND subject_id = ?2 ORDER BY created_at DESC LIMIT 1",
      )
      .bind("magnus.conversation_read_by_administrator", attorneyConversation)
      .all<{ metadata: string }>();
    expect(JSON.parse(results[0]?.metadata ?? "{}")).toEqual({ authorUserId: attorneyUserId });
  });

  it("the firm-wide list scope needs the administrative permission", async () => {
    const refused = await get("/api/v1/magnus/conversations?scope=firm", attorneyCookie);
    expect(refused.status).toBe(403);
    const allowed = await get("/api/v1/magnus/conversations?scope=firm", ownerCookie);
    expect(allowed.status).toBe(200);
  });

  it("the matter filter narrows the list to one matter's file and leaves the rest out", async () => {
    const matterId = newIdentifier("matter");
    const otherMatterId = newIdentifier("matter");
    const onTheMatter = await post(
      "/api/v1/magnus/conversations",
      { title: "On the matter", matterId },
      ownerCookie,
    );
    expect(onTheMatter.status).toBe(201);
    const onAnother = await post(
      "/api/v1/magnus/conversations",
      { title: "On another", matterId: otherMatterId },
      ownerCookie,
    );
    expect(onAnother.status).toBe(201);
    const onNoMatter = await startConversation(ownerCookie);

    const filtered = await get(`/api/v1/magnus/conversations?matterId=${matterId}`, ownerCookie);
    expect(filtered.status).toBe(200);
    const page = await readJson<{ data: Array<{ id: string; matterId: string | null }> }>(filtered);
    expect(page.data.map((row) => row.id)).toEqual([
      (await readJson<{ id: string }>(onTheMatter.clone())).id,
    ]);
    expect(page.data.every((row) => row.matterId === matterId)).toBe(true);

    // The unfiltered read is unchanged: the filter narrows, it does not become a default.
    const unfiltered = await get("/api/v1/magnus/conversations", ownerCookie);
    const all = await readJson<{ data: Array<{ id: string }> }>(unfiltered);
    expect(all.data.map((row) => row.id)).toContain(onNoMatter);
  });

  it("orders the whole record by name and by matter on the server, and pages within that order", async () => {
    // A rail sorted over the page it happens to hold is not sorted, so every order is the server's.
    const owner = await seedCredentialedUser("magnus-sorter@example.com", {
      userName: "Magnus Sorter",
      firmId,
    });
    await insertMemberStatement(firmDatabase, {
      userId: owner.userId,
      displayName: "Magnus Sorter",
      now: clock.now(),
    }).run();
    await firmDatabase
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
      )
      .bind(newIdentifier("grant"), owner.userId, "magnus:converse", clock.now())
      .run();
    const cookie = await signInForSessionCookie("magnus-sorter@example.com");
    await acknowledgeFor(cookie);

    const matterA = newIdentifier("matter");
    const matterB = newIdentifier("matter");
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Zebra Holdings', 'open', ?4, ?3, ?3), (?2, 'Alder Trust', 'open', ?4, ?3, ?3)",
      )
      .bind(matterA, matterB, clock.now(), attorneyUserId)
      .run();

    const started: string[] = [];
    for (const [title, matterId] of [
      ["Charlie", matterA],
      [null, null],
      ["alpha", matterB],
      ["Bravo", null],
    ] as const) {
      const response = await post(
        "/api/v1/magnus/conversations",
        { title, ...(matterId === null ? {} : { matterId }) },
        cookie,
      );
      expect(response.status).toBe(201);
      started.push((await readJson<{ id: string }>(response)).id);
    }
    const [charlie, unnamed, alpha, bravo] = started;

    const byName = await readJson<{ data: Array<{ id: string }> }>(
      await get("/api/v1/magnus/conversations?sort=name", cookie),
    );
    // Named ones by their title regardless of case, then the unnamed one, which reads as a date.
    expect(byName.data.map((row) => row.id)).toEqual([alpha, bravo, charlie, unnamed]);

    const byMatter = await readJson<{ data: Array<{ id: string }> }>(
      await get("/api/v1/magnus/conversations?sort=matter", cookie),
    );
    // Grouped by the matter's TITLE (Alder before Zebra), with the conversations on no matter last,
    // and newest first within a group.
    expect(byMatter.data.map((row) => row.id)).toEqual([alpha, charlie, bravo, unnamed]);

    const byDate = await readJson<{ data: Array<{ id: string }> }>(
      await get("/api/v1/magnus/conversations", cookie),
    );
    expect(byDate.data.map((row) => row.id)).toEqual([bravo, alpha, unnamed, charlie]);
  });

  it("keeps a conversation on another matter, refuses a closed one, and audits both matters", async () => {
    const openMatter = newIdentifier("matter");
    const closedMatter = newIdentifier("matter");
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Open File', 'open', ?4, ?3, ?3), (?2, 'Closed File', 'closed', ?4, ?3, ?3)",
      )
      .bind(openMatter, closedMatter, clock.now(), attorneyUserId)
      .run();
    const conversationId = await startConversation();

    const refused = await patch(`/api/v1/magnus/conversations/${conversationId}/matter`, {
      matterId: closedMatter,
    });
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).title).toContain("closed");

    const before = await auditCount("magnus.conversation_moved");
    const moved = await patch(`/api/v1/magnus/conversations/${conversationId}/matter`, {
      matterId: openMatter,
    });
    expect(moved.status).toBe(200);
    expect((await readJson<{ matterId: string | null }>(moved)).matterId).toBe(openMatter);
    expect(await auditCount("magnus.conversation_moved")).toBe(before + 1);
    const { results } = await firmDatabase
      .prepare("SELECT metadata FROM audit_log WHERE event = 'magnus.conversation_moved'")
      .all<{ metadata: string }>();
    expect(results.at(-1)?.metadata).toContain(openMatter);

    // And off every matter again: the reverse is the same write with null.
    const cleared = await patch(`/api/v1/magnus/conversations/${conversationId}/matter`, {
      matterId: null,
    });
    expect(cleared.status).toBe(200);
    expect((await readJson<{ matterId: string | null }>(cleared)).matterId).toBeNull();
  });

  it("attaches one of the matter's own files by reference, and refuses another matter's", async () => {
    const matterId = newIdentifier("matter");
    const otherMatterId = newIdentifier("matter");
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Attach File', 'open', ?4, ?3, ?3), (?2, 'Other File', 'open', ?4, ?3, ?3)",
      )
      .bind(matterId, otherMatterId, clock.now(), attorneyUserId)
      .run();
    const ownFile = newIdentifier("file");
    const foreignFile = newIdentifier("file");
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'lease.pdf', NULL, NULL, NULL, ?4, ?4), (?3, ?5, NULL, 'other.pdf', NULL, NULL, NULL, ?4, ?4)",
      )
      .bind(ownFile, matterId, foreignFile, clock.now(), otherMatterId)
      .run();

    const onNoMatter = await startConversation();
    const refusedNoMatter = await post(`/api/v1/magnus/conversations/${onNoMatter}/attachments`, {
      fileId: ownFile,
    });
    expect(refusedNoMatter.status).toBe(422);

    const started = await post("/api/v1/magnus/conversations", { title: "With files", matterId });
    const conversationId = (await readJson<{ id: string }>(started)).id;

    const foreign = await post(`/api/v1/magnus/conversations/${conversationId}/attachments`, {
      fileId: foreignFile,
    });
    expect(foreign.status).toBe(422);

    const attached = await post(`/api/v1/magnus/conversations/${conversationId}/attachments`, {
      fileId: ownFile,
    });
    expect(attached.status).toBe(201);
    const attachments =
      await readJson<Array<{ fileId: string; name: string | null; textStatus: string }>>(attached);
    expect(attachments).toEqual([
      expect.objectContaining({ fileId: ownFile, name: "lease.pdf", textStatus: "pending" }),
    ]);

    // The detail carries them, and the audit row names the file and nothing of it.
    const detail = await readJson<{ attachments: Array<{ fileId: string }> }>(
      await get(`/api/v1/magnus/conversations/${conversationId}`),
    );
    expect(detail.attachments.map((row) => row.fileId)).toEqual([ownFile]);
    expect(await auditCount("magnus.attachment_added")).toBeGreaterThan(0);

    const detached = await remove(
      `/api/v1/magnus/conversations/${conversationId}/attachments/${ownFile}`,
    );
    expect(detached.status).toBe(200);
    expect(await readJson<unknown[]>(detached)).toEqual([]);
  });

  it("the events route refuses a non-upgrade request with 426 rather than hanging", async () => {
    const conversationId = await startConversation();
    const response = await get(`/api/v1/magnus/conversations/${conversationId}/events`);
    expect(response.status).toBe(426);
    expect((await readJson<ProblemBody>(response)).type).toContain("websocket-upgrade-required");
  });

  it("keeps a conversation in a member's own folder and pin, which is theirs alone", async () => {
    const folderName = "Henderson lease research";
    const made = await post("/api/v1/magnus/folders", { name: folderName });
    expect(made.status).toBe(201);
    const folder = await readJson<{ id: string; name: string }>(made);
    expect(folder.id).toMatch(/^magnusFolder_/);
    expect(folder.name).toBe(folderName);

    const conversationId = await startConversation();
    const shelve = (body: unknown, cookie = ownerCookie) =>
      SELF.fetch(`https://example.com/api/v1/magnus/conversations/${conversationId}/shelf`, {
        method: "PUT",
        headers: headers(cookie, true),
        body: JSON.stringify(body),
      });

    // A conversation nobody has moved is in General and unpinned.
    const before = await readJson<{ conversation: { folderId: string | null; pinnedAt: unknown } }>(
      await get(`/api/v1/magnus/conversations/${conversationId}`),
    );
    expect(before.conversation).toMatchObject({ folderId: null, pinnedAt: null });

    const shelved = await shelve({ folderId: folder.id, pinned: true });
    expect(shelved.status).toBe(200);
    const shelf = await readJson<{ folderId: string; pinnedAt: string }>(shelved);
    expect(shelf.folderId).toBe(folder.id);
    expect(shelf.pinnedAt).not.toBeNull();

    const inFolder = await readJson<{ data: Array<{ id: string; folderId: string | null }> }>(
      await get(`/api/v1/magnus/conversations?folder=${folder.id}`),
    );
    expect(inFolder.data.map((row) => row.id)).toEqual([conversationId]);
    const general = await readJson<{ data: Array<{ id: string }> }>(
      await get("/api/v1/magnus/conversations?folder=general"),
    );
    expect(general.data.some((row) => row.id === conversationId)).toBe(false);
    const pinned = await readJson<{ data: Array<{ id: string }> }>(
      await get("/api/v1/magnus/conversations?pinned=true"),
    );
    expect(pinned.data.map((row) => row.id)).toContain(conversationId);

    // Moving a pinned conversation keeps the instant it was pinned.
    const moved = await readJson<{ pinnedAt: string }>(
      await shelve({ folderId: null, pinned: true }),
    );
    expect(moved.pinnedAt).toBe(shelf.pinnedAt);

    // Another member's folder is reported as absent, and so is the folder route on it.
    const theirs = await post("/api/v1/magnus/folders", { name: "Mine" }, attorneyCookie);
    const theirFolder = await readJson<{ id: string }>(theirs);
    expect((await shelve({ folderId: theirFolder.id, pinned: false })).status).toBe(404);
    expect((await patch(`/api/v1/magnus/folders/${theirFolder.id}`, { name: "x" })).status).toBe(
      404,
    );
    const listedFolders = await readJson<{ data: Array<{ id: string }> }>(
      await get("/api/v1/magnus/folders"),
    );
    expect(listedFolders.data.map((row) => row.id)).toEqual([folder.id]);

    // Removing a folder puts what was in it back in General and removes no conversation.
    await shelve({ folderId: folder.id, pinned: false });
    expect((await remove(`/api/v1/magnus/folders/${folder.id}`)).status).toBe(200);
    const afterRemoval = await readJson<{ conversation: { folderId: string | null } }>(
      await get(`/api/v1/magnus/conversations/${conversationId}`),
    );
    expect(afterRemoval.conversation.folderId).toBeNull();

    // The audit rows say a folder existed, never what it was called.
    const { results } = await firmDatabase
      .prepare("SELECT metadata FROM audit_log WHERE event LIKE 'magnus.folder_%'")
      .all<{ metadata: string | null }>();
    expect(results.length).toBeGreaterThan(0);
    for (const row of results) expect(row.metadata ?? "").not.toContain("Henderson");
  });

  it("NO audit row anywhere carries what a member typed", async () => {
    const conversationId = await startConversation();
    const secret = "Alvarez pretrial order in Judge Kim's court";
    const submitted = await post(`/api/v1/magnus/conversations/${conversationId}/turns`, {
      content: secret,
    });
    expect(submitted.status).toBe(202);

    const { results } = await firmDatabase
      .prepare("SELECT event, metadata FROM audit_log")
      .all<{ event: string; metadata: string | null }>();
    expect(results.length).toBeGreaterThan(0);
    for (const row of results) {
      expect(row.metadata ?? "").not.toContain(secret);
      expect(row.metadata ?? "").not.toContain("Alvarez");
    }

    // And the outbox row the submission wrote carries identifiers only.
    const { results: outbox } = await firmDatabase
      .prepare("SELECT payload FROM outbox WHERE topic = ?1")
      .bind("magnus.turn_submitted")
      .all<{ payload: string }>();
    expect(outbox.length).toBeGreaterThan(0);
    for (const row of outbox) expect(row.payload).not.toContain("Alvarez");
  });
});

async function auditCount(event: string): Promise<number> {
  const { results } = await firmDatabase
    .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
}
