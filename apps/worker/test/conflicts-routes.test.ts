import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenAPIDocument } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The conflicts route surface, driven through the chokepoint over real Miniflare bindings: running a
// check against the directory corpus, reading it back with its hits, and recording a reviewer's
// disposition of a hit. conflicts:run and conflicts:read are seeded broadly (every default role,
// including Owner/Admin); a caller with neither gets refused before any check runs. Mutations require
// an Idempotency-Key (the chokepoint gate), and a repeated key replays the first check rather than
// running a second.

let poolFirmId: FirmId;
let ownerCookie: string;
let noPermissionCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

// Seeds a member with no role and a single, unrelated direct-grant permission — used to prove the
// chokepoint refuses conflicts:run to a caller who genuinely lacks it.
async function mirrorMemberWithUnrelatedGrant(userId: UserId, displayName: string): Promise<void> {
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, "firm:reportIncident", clock.now())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Conflicts Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser("conflicts-owner@example.com", {
    userName: "Conflicts Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Conflicts Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("conflicts-owner@example.com");

  const noPermission = await seedCredentialedUser("conflicts-nopermission@example.com", {
    userName: "No Permission",
    firmId: poolFirmId,
  });
  await mirrorMemberWithUnrelatedGrant(noPermission.userId, "No Permission");
  noPermissionCookie = await signInForSessionCookie("conflicts-nopermission@example.com");
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie, withKey = true) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, withKey),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function postWithFixedKey(path: string, body: unknown, idempotencyKey: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function createPerson(given: string, family: string): Promise<string> {
  const response = await post("/api/v1/directory/persons", { given, family });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

describe("conflicts check routes", () => {
  it("runs a check and returns a handle", async () => {
    const personId = await createPerson("Solo", "Subject");

    const response = await post("/api/v1/conflicts/checks", {
      trigger: "comprehensive",
      subjectEntityIds: [personId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(/^conflictsCheck_/);
  });

  it("reads a check back with its hits, and dispositions a surfaced hit", async () => {
    // Two persons sharing a name so the check surfaces one as a conflicts hit for the other.
    const subjectId = await createPerson("Marguerite", "Castellane");
    const matchId = await createPerson("Marguerite", "Castellane");

    const created = await post("/api/v1/conflicts/checks", {
      trigger: "new_party",
      subjectEntityIds: [subjectId],
      scope: { sources: ["party"], strictness: "over_inclusive", depth: 1 },
    });
    expect(created.status).toBe(201);
    const { id: checkId } = (await created.json()) as { id: string };

    const read = await get(`/api/v1/conflicts/checks/${checkId}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      check: { id: string; trigger: string; subjectEntityIds: string[] };
      hits: Array<{ id: string; entityId: string; disposition: unknown }>;
    };
    expect(body.check.id).toBe(checkId);
    expect(body.check.trigger).toBe("new_party");
    expect(body.check.subjectEntityIds).toContain(subjectId);
    expect(body.hits.some((hit) => hit.entityId === matchId)).toBe(true);

    const hit = body.hits.find((candidate) => candidate.entityId === matchId);
    expect(hit).toBeDefined();
    expect(hit?.disposition).toBeNull();

    const disposed = await post(`/api/v1/conflicts/hits/${hit?.id}/dispositions`, {
      kind: "cleared",
      rationale: "same name, unrelated matter — no conflict on review",
    });
    expect(disposed.status).toBe(201);
    const { id: dispositionId } = (await disposed.json()) as { id: string };
    expect(dispositionId).toMatch(/^conflictsDisposition_/);

    // Reading the check again now shows the recorded disposition on the hit.
    const readAgain = await get(`/api/v1/conflicts/checks/${checkId}`);
    const bodyAgain = (await readAgain.json()) as {
      hits: Array<{ id: string; disposition: { kind: string } | null }>;
    };
    const hitAgain = bodyAgain.hits.find((candidate) => candidate.id === hit?.id);
    expect(hitAgain?.disposition?.kind).toBe("cleared");
  });

  it("refuses a caller lacking conflicts:run (403)", async () => {
    const response = await post(
      "/api/v1/conflicts/checks",
      {
        trigger: "comprehensive",
        subjectEntityIds: [],
        scope: { sources: ["party"], strictness: "balanced", depth: 1 },
      },
      noPermissionCookie,
    );
    expect(response.status).toBe(403);
  });

  it("rejects a request omitting trigger (422)", async () => {
    const response = await post("/api/v1/conflicts/checks", {
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    });
    expect(response.status).toBe(422);
  });

  it("dedups a repeated Idempotency-Key — the retry returns the first check's id", async () => {
    const key = crypto.randomUUID();
    const body = {
      trigger: "periodic_rescan",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    };

    const first = await postWithFixedKey("/api/v1/conflicts/checks", body, key);
    expect(first.status).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };

    const replay = await postWithFixedKey("/api/v1/conflicts/checks", body, key);
    expect(replay.status).toBe(201);
    const { id: replayId } = (await replay.json()) as { id: string };
    expect(replayId).toBe(firstId);

    const countResult = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM conflicts_check WHERE id = ?1")
      .bind(firstId)
      .all<{ c: number }>();
    expect(countResult.results[0]?.c).toBe(1);
  });
});

describe("conflicts contract", () => {
  it("registers the conflicts operations in the OpenAPI document", () => {
    const document = buildOpenAPIDocument();
    const operationIds = new Set<string>();
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ["get", "post"] as const) {
        const operation = (item as Record<string, { operationId?: string } | undefined>)[method];
        if (operation?.operationId) operationIds.add(operation.operationId);
      }
    }
    expect(operationIds.has("conflicts.runCheck")).toBe(true);
    expect(operationIds.has("conflicts.getCheck")).toBe(true);
    expect(operationIds.has("conflicts.recordDisposition")).toBe(true);
  });
});
