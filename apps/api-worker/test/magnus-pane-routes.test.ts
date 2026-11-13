import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MagnusConversationId,
  MagnusTurnId,
  UserId,
} from "@magna-carta/identifiers/types";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { writeDocuments } from "@magna-carta/magnus/artifact";
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

// The right pane's routes, driven through the chokepoint over real Miniflare bindings: turning
// Magnus's read permissions on and off, and the documents Magnus wrote. Its own firm, because the
// rate limit is the firm's. The load-bearing assertions: every permission starts off and only the
// author changes one, audited by name; a document is read by whoever reads the conversation, and
// restoring a version adds one and overwrites none.

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

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Magnus Permissions Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("magnus-permissions-owner@example.com", {
    userName: "Magnus Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Magnus Owner", firmId);
  ownerCookie = await signInForSessionCookie("magnus-permissions-owner@example.com");

  const attorney = await seedCredentialedUser("magnus-permissions-attorney@example.com", {
    userName: "Magnus Attorney",
    firmId,
  });
  attorneyUserId = attorney.userId as UserId;
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
  attorneyCookie = await signInForSessionCookie("magnus-permissions-attorney@example.com");

  await writeSetting(aiProcessingEligibilityDefinition, true);
  await writeSetting(magnusEnabledDefinition, true);
  for (const cookie of [ownerCookie, attorneyCookie]) {
    const response = await send("POST", "/api/v1/magnus/acknowledgement", {}, cookie);
    expect(response.status).toBe(200);
  }
});

async function send(method: string, path: string, body: unknown, cookie: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function permissionsOf(conversationId: string, cookie: string): Promise<string[]> {
  const response = await SELF.fetch(
    `https://example.com/api/v1/magnus/conversations/${conversationId}`,
    { headers: { origin: "https://example.com", cookie } },
  );
  expect(response.status).toBe(200);
  return (await readJson<{ permissions: string[] }>(response)).permissions;
}

describe("a conversation's read permissions", () => {
  it("start off, turn on and off for the author, and are audited by name", async () => {
    const started = await send(
      "POST",
      "/api/v1/magnus/conversations",
      { title: "Permissions" },
      attorneyCookie,
    );
    expect(started.status).toBe(201);
    const conversationId = (await readJson<{ id: string }>(started)).id;
    expect(await permissionsOf(conversationId, attorneyCookie)).toEqual([]);

    const path = `/api/v1/magnus/conversations/${conversationId}/permissions/own-matter-conversations`;
    const on = await send("PUT", path, { granted: true }, attorneyCookie);
    expect(on.status).toBe(200);
    expect((await readJson<{ permissions: string[] }>(on)).permissions).toEqual([
      "own-matter-conversations",
    ]);
    // Turning it on again changes nothing.
    expect((await send("PUT", path, { granted: true }, attorneyCookie)).status).toBe(200);
    expect(await permissionsOf(conversationId, attorneyCookie)).toEqual([
      "own-matter-conversations",
    ]);

    const off = await send("PUT", path, { granted: false }, attorneyCookie);
    expect(off.status).toBe(200);
    expect((await readJson<{ permissions: string[] }>(off)).permissions).toEqual([]);

    const { results } = await firmDatabase
      .prepare(
        "SELECT event, metadata FROM audit_log WHERE subject_id = ?1 AND event LIKE 'magnus.permission_%' ORDER BY created_at",
      )
      .bind(conversationId)
      .all<{ event: string; metadata: string }>();
    expect(results.map((row) => row.event)).toEqual([
      "magnus.permission_granted",
      "magnus.permission_granted",
      "magnus.permission_revoked",
    ]);
    expect(results[0]?.metadata).toContain("own-matter-conversations");
  });

  it("refuses anyone but the author, and an unknown permission", async () => {
    const started = await send(
      "POST",
      "/api/v1/magnus/conversations",
      { title: "Not yours" },
      attorneyCookie,
    );
    const conversationId = (await readJson<{ id: string }>(started)).id;
    const notAuthor = await send(
      "PUT",
      `/api/v1/magnus/conversations/${conversationId}/permissions/own-matter-conversations`,
      { granted: true },
      ownerCookie,
    );
    expect(notAuthor.status).toBe(404);
    const unknown = await send(
      "PUT",
      `/api/v1/magnus/conversations/${conversationId}/permissions/firm-everything`,
      { granted: true },
      attorneyCookie,
    );
    expect(unknown.status).toBe(422);
    expect(await permissionsOf(conversationId, attorneyCookie)).toEqual([]);
  });
});

// Two versions of one document in a new conversation of the attorney's, as two answers would write it.
async function conversationWithDocument(): Promise<{ conversationId: string; artifactId: string }> {
  const started = await send(
    "POST",
    "/api/v1/magnus/conversations",
    { title: "Documents" },
    attorneyCookie,
  );
  const conversationId = (await readJson<{ id: string }>(started)).id as MagnusConversationId;
  const artifactId = newIdentifier("magnusArtifact");
  const context = { clock, actorUserId: null };
  for (const [index, content] of ["First draft.", "Second draft."].entries()) {
    await commitEffectBatch(
      firmDatabase,
      {
        statements: writeDocuments(firmDatabase, context, {
          conversationId,
          magnusTurnId: newIdentifier("magnusTurn") as MagnusTurnId,
          memberUserId: attorneyUserId,
          documents: [{ title: "Engagement Letter", note: null, content }],
          existing: index === 0 ? new Map() : new Map([["engagement letter", artifactId]]),
          newArtifactId: () => artifactId,
        }),
        outboxMessages: [],
      },
      { now: clock.now },
    );
  }
  return { conversationId, artifactId };
}

describe("the documents Magnus wrote", () => {
  it("lists them with their versions and serves each version's text", async () => {
    const { conversationId, artifactId } = await conversationWithDocument();
    const listed = await SELF.fetch(
      `https://example.com/api/v1/magnus/conversations/${conversationId}/artifacts`,
      { headers: { origin: "https://example.com", cookie: attorneyCookie } },
    );
    expect(listed.status).toBe(200);
    const { artifacts } = await readJson<{
      artifacts: Array<{ id: string; title: string; versions: Array<{ versionNumber: number }> }>;
    }>(listed);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe("Engagement Letter");
    expect(artifacts[0]?.versions.map((version) => version.versionNumber)).toEqual([1, 2]);

    const first = await SELF.fetch(
      `https://example.com/api/v1/magnus/conversations/${conversationId}/artifacts/${artifactId}/versions/1`,
      { headers: { origin: "https://example.com", cookie: attorneyCookie } },
    );
    expect(first.status).toBe(200);
    expect((await readJson<{ content: string }>(first)).content).toBe("First draft.");

    // The owner holds the supervisory permission, so reads the attorney's documents too.
    const supervised = await SELF.fetch(
      `https://example.com/api/v1/magnus/conversations/${conversationId}/artifacts`,
      { headers: { origin: "https://example.com", cookie: ownerCookie } },
    );
    expect(supervised.status).toBe(200);
  });

  it("restores an earlier version as the newest, keeping every version, for the author alone", async () => {
    const { conversationId, artifactId } = await conversationWithDocument();
    const path = `/api/v1/magnus/conversations/${conversationId}/artifacts/${artifactId}/restore`;
    expect((await send("POST", path, { versionNumber: 1 }, ownerCookie)).status).toBe(404);

    const restored = await send("POST", path, { versionNumber: 1 }, attorneyCookie);
    expect(restored.status).toBe(200);
    const body = await readJson<{
      versions: Array<{ versionNumber: number; restoredFromVersion: number | null }>;
    }>(restored);
    expect(body.versions.map((version) => version.versionNumber)).toEqual([1, 2, 3]);
    expect(body.versions[2]?.restoredFromVersion).toBe(1);

    const third = await SELF.fetch(
      `https://example.com/api/v1/magnus/conversations/${conversationId}/artifacts/${artifactId}/versions/3`,
      { headers: { origin: "https://example.com", cookie: attorneyCookie } },
    );
    expect((await readJson<{ content: string }>(third)).content).toBe("First draft.");

    const missing = await send("POST", path, { versionNumber: 9 }, attorneyCookie);
    expect(missing.status).toBe(404);
  });
});
