import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { magnusEnabledDefinition } from "@magna-carta/magnus/settings";
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

// Editing and removing one's own message, driven through the chokepoint over real Miniflare bindings.
//
// Its own firm, because the rate limit is the firm's and the main Magnus route suite already spends
// most of a minute's budget. The load-bearing assertions: neither act erases anything, the author no
// longer sees what they removed while a supervisory read still does, and nothing changes under an
// answer still being written.

let firmId: FirmId;
let ownerCookie: string;
let attorneyCookie: string;
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

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Magnus Turn Changes Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("magnus-changes-owner@example.com", {
    userName: "Magnus Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Magnus Owner", firmId);
  ownerCookie = await signInForSessionCookie("magnus-changes-owner@example.com");

  // A second member holding magnus:converse but NOT magnus:readAllConversations, so the
  // administrative-read branch can be tested from both sides.
  const attorney = await seedCredentialedUser("magnus-changes-attorney@example.com", {
    userName: "Magnus Attorney",
    firmId,
  });
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
  attorneyCookie = await signInForSessionCookie("magnus-changes-attorney@example.com");
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

describe("changing one's own message", () => {
  beforeAll(async () => {
    await openBothGates();
    await acknowledgeFor(ownerCookie);
    await acknowledgeFor(attorneyCookie);
  });

  it("edits a message: the old one and its answer are set aside and the new one names it", async () => {
    const conversationId = await startConversation(attorneyCookie);
    const first = await askAndSettle(
      conversationId,
      "the first question",
      "the first answer",
      attorneyCookie,
    );
    const response = await patch(
      `/api/v1/magnus/conversations/${conversationId}/turns/${first.memberTurnId}`,
      { content: "the question, put better" },
      attorneyCookie,
    );
    expect(response.status).toBe(202);
    const edited = await readJson<{ memberTurnId: string; status: string }>(response);
    expect(edited.status).toBe("pending");

    const turns = await readTurns(conversationId, attorneyCookie);
    const old = turns.find((turn) => turn.id === first.memberTurnId);
    const oldAnswer = turns.find((turn) => turn.id === first.magnusTurnId);
    expect(old?.supersededAt).not.toBeNull();
    expect(oldAnswer?.supersededAt).not.toBeNull();
    // Kept on the record, words and all.
    expect(old?.content).toBe("the first question");
    const replacement = turns.find((turn) => turn.id === edited.memberTurnId);
    expect(replacement?.replacesTurnId).toBe(first.memberTurnId);
    expect(replacement?.supersededAt).toBeNull();
  });

  it("refuses to change a message while an answer is pending, an answer itself, or one already set aside", async () => {
    const conversationId = await startConversation(attorneyCookie);
    const first = await askAndSettle(conversationId, "a question", "an answer", attorneyCookie);
    const answerRefused = await remove(
      `/api/v1/magnus/conversations/${conversationId}/turns/${first.magnusTurnId}`,
      attorneyCookie,
    );
    expect(answerRefused.status).toBe(409);
    expect((await readJson<ProblemBody>(answerRefused)).type).toContain("magnus-turn-unchangeable");

    const pending = await post(
      `/api/v1/magnus/conversations/${conversationId}/turns`,
      {
        content: "a second question",
      },
      attorneyCookie,
    );
    expect(pending.status).toBe(202);
    const whilePending = await remove(
      `/api/v1/magnus/conversations/${conversationId}/turns/${first.memberTurnId}`,
      attorneyCookie,
    );
    expect(whilePending.status).toBe(409);
  });

  it("removes a message and keeps its answer: the message hidden from its author, kept for a supervisory read", async () => {
    const conversationId = await startConversation(attorneyCookie);
    const pair = await askAndSettle(
      conversationId,
      "Alvarez's settlement figure",
      "the answer",
      attorneyCookie,
    );
    const before = await auditCount("magnus.turn_removed");
    const response = await remove(
      `/api/v1/magnus/conversations/${conversationId}/turns/${pair.memberTurnId}`,
      attorneyCookie,
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      memberTurnId: pair.memberTurnId,
      magnusTurnId: pair.magnusTurnId,
    });
    expect(await auditCount("magnus.turn_removed")).toBe(before + 1);

    const authorView = await readTurns(conversationId, attorneyCookie);
    const question = authorView.find((turn) => turn.id === pair.memberTurnId);
    expect(question?.removedAt).not.toBeNull();
    expect(question?.content).toBeNull();
    const answer = authorView.find((turn) => turn.id === pair.magnusTurnId);
    expect(answer?.removedAt).toBeNull();
    expect(answer?.content).toBe("the answer");
    const supervisorView = await readTurns(conversationId, ownerCookie);
    expect(supervisorView.find((turn) => turn.id === pair.memberTurnId)?.content).toBe(
      "Alvarez's settlement figure",
    );

    const again = await remove(
      `/api/v1/magnus/conversations/${conversationId}/turns/${pair.memberTurnId}`,
      attorneyCookie,
    );
    expect(again.status).toBe(409);
  });

  it("only the conversation's author changes its messages", async () => {
    const conversationId = await startConversation(attorneyCookie);
    const pair = await askAndSettle(conversationId, "a question", "an answer", attorneyCookie);
    const response = await remove(
      `/api/v1/magnus/conversations/${conversationId}/turns/${pair.memberTurnId}`,
      ownerCookie,
    );
    expect(response.status).toBe(404);
  });
});

interface TurnOnTheWire {
  readonly id: string;
  readonly content: string | null;
  readonly removedAt: string | null;
  readonly supersededAt: string | null;
  readonly replacesTurnId: string | null;
}

async function readTurns(conversationId: string, cookie = ownerCookie): Promise<TurnOnTheWire[]> {
  const response = await get(`/api/v1/magnus/conversations/${conversationId}`, cookie);
  expect(response.status).toBe(200);
  return (await readJson<{ turns: { data: TurnOnTheWire[] } }>(response)).turns.data;
}

// Asks a question and settles its answer directly, so a test can change the message without waiting
// on the answering consumer.
async function askAndSettle(
  conversationId: string,
  question: string,
  answer: string,
  cookie = ownerCookie,
): Promise<{ memberTurnId: string; magnusTurnId: string }> {
  const response = await post(
    `/api/v1/magnus/conversations/${conversationId}/turns`,
    { content: question },
    cookie,
  );
  expect(response.status).toBe(202);
  const pair = await readJson<{ memberTurnId: string; magnusTurnId: string }>(response);
  await firmDatabase
    .prepare(
      "UPDATE magnus_turn SET status = 'complete', content = ?2, completed_at = ?3 WHERE id = ?1",
    )
    .bind(pair.magnusTurnId, answer, clock.now())
    .run();
  return pair;
}

async function auditCount(event: string): Promise<number> {
  const { results } = await firmDatabase
    .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
}
