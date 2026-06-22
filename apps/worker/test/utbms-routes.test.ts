import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { seedUtbmsCatalogStatements, UTBMS_CODE_TABLE } from "@magna-carta/timekeeping/utbms-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// UTBMS code routes: the HTTP surface for listing codes by code set, enabling and disabling
// individual codes, and the 403/404 guardrails. The catalog is seeded in beforeAll — enable/disable
// toggle the active flag on a row that must already exist; an unknown id produces 404 (the service
// pre-reads existence to avoid a phantom audit row for a subject that never existed).

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
let firstTaskCodeId: string;

const clock = { now: () => new Date().toISOString() };

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({ name: "UTBMS Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("utbms-owner@example.com", {
    userName: "UTBMS Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "UTBMS Owner");
  ownerCookie = await signInForSessionCookie("utbms-owner@example.com");

  const readOnly = await seedCredentialedUser("utbms-readonly@example.com", {
    userName: "UTBMS Read Only",
    firmId: poolFirmId,
  });
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind("Read-only")
    .first<{ id: string }>();
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId: readOnly.userId,
    displayName: "UTBMS Read Only",
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: readOnly.userId,
    roleId: assertIdentifier(role!.id, "role"),
  }).run();
  readOnlyCookie = await signInForSessionCookie("utbms-readonly@example.com");

  // Seed the ABA UTBMS catalog into the per-firm database. The statements are
  // INSERT OR IGNORE so a re-seed is a no-op.
  const statements = seedUtbmsCatalogStatements(env.DB_FIRM_POOL_1);
  await commitEffectBatch(env.DB_FIRM_POOL_1, { statements, outboxMessages: [] }, { now: clock.now });

  // Pick the first task-set code id for use in enable/disable tests.
  const first = await env.DB_FIRM_POOL_1.prepare(
    `SELECT id FROM ${UTBMS_CODE_TABLE} WHERE code_set = 'task' ORDER BY code LIMIT 1`,
  ).first<{ id: string }>();
  firstTaskCodeId = first!.id;
});

function writeHeaders(cookie: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}
function readHeaders(cookie: string): HeadersInit {
  return { origin: "https://example.com", cookie };
}

async function post(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: writeHeaders(cookie),
    body: JSON.stringify({}),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: readHeaders(cookie) });
}

describe("UTBMS code list", () => {
  it("lists codes by code set (task)", async () => {
    const response = await get("/api/v1/utbms-codes?codeSet=task");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; codeSet: string; code: string; label: string; active: number }[];
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((c) => c.codeSet === "task")).toBe(true);
  });
});

describe("enable / disable", () => {
  it("enables and disables a task code, re-reads to confirm", async () => {
    // Enable
    const enableResponse = await post(`/api/v1/utbms-codes/${firstTaskCodeId}/enable`);
    expect(enableResponse.status).toBe(200);
    const { utbmsCodeId } = (await enableResponse.json()) as { utbmsCodeId: string };
    expect(utbmsCodeId).toBe(firstTaskCodeId);

    // Disable
    const disableResponse = await post(`/api/v1/utbms-codes/${firstTaskCodeId}/disable`);
    expect(disableResponse.status).toBe(200);

    // Confirm the active flag is 0 in the database
    const row = await env.DB_FIRM_POOL_1.prepare(
      `SELECT active FROM ${UTBMS_CODE_TABLE} WHERE id = ?1`,
    )
      .bind(firstTaskCodeId)
      .first<{ active: number }>();
    expect(row?.active).toBe(0);
  });

  it("returns 404 for an unknown code id on enable", async () => {
    const phantomId = "utbmsCode_task_XXXXX"; // no such row
    const response = await SELF.fetch(
      `https://example.com/api/v1/utbms-codes/${phantomId}/enable`,
      {
        method: "POST",
        headers: writeHeaders(ownerCookie),
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(404);
  });
});

describe("permission gate", () => {
  it("refuses a Read-only member the time:manageUtbms capability (403)", async () => {
    const response = await post(
      `/api/v1/utbms-codes/${firstTaskCodeId}/enable`,
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
