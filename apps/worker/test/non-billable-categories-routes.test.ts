import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { NON_BILLABLE_CATEGORY_TABLE } from "@magna-carta/timekeeping/non-billable-category-statements";
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

// Non-billable category routes: the HTTP surface for create, list, rename (PATCH), and soft-archive.
// Archive is soft-only — the row is stamped with archived_at and never hard-deleted so historical
// entries that reference it remain intact. An unknown id on archive returns 404 (the service
// pre-reads existence to avoid a phantom audit row for a subject that never existed).

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({
      name: "Non-Billable Category Test Firm",
      databaseIdentifier: "DB_FIRM_POOL_1",
    })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("nbc-owner@example.com", {
    userName: "NBC Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "NBC Owner");
  ownerCookie = await signInForSessionCookie("nbc-owner@example.com");

  const readOnly = await seedCredentialedUser("nbc-readonly@example.com", {
    userName: "NBC Read Only",
    firmId: poolFirmId,
  });
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind("Read-only")
    .first<{ id: string }>();
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId: readOnly.userId,
    displayName: "NBC Read Only",
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: readOnly.userId,
    roleId: assertIdentifier(role!.id, "role"),
  }).run();
  readOnlyCookie = await signInForSessionCookie("nbc-readonly@example.com");
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

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: writeHeaders(cookie),
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: writeHeaders(cookie),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: readHeaders(cookie) });
}

describe("non-billable category lifecycle", () => {
  it("creates, lists, updates, and archives a category", async () => {
    // Create
    const createResponse = await post("/api/v1/non-billable-categories", {
      name: "Marketing",
    });
    expect(createResponse.status).toBe(201);
    const { nonBillableCategoryId } = (await createResponse.json()) as {
      nonBillableCategoryId: string;
    };
    expect(nonBillableCategoryId).toMatch(/^nonBillableCategory_/);

    // List — the created category must appear
    const listResponse = await get("/api/v1/non-billable-categories");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      data: { id: string; name: string; archivedAt: string | null }[];
    };
    expect(list.data.some((cat) => cat.id === nonBillableCategoryId)).toBe(true);

    // Update (rename)
    const updateResponse = await patch(`/api/v1/non-billable-categories/${nonBillableCategoryId}`, {
      name: "Business Marketing",
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as { nonBillableCategoryId: string };
    expect(updated.nonBillableCategoryId).toBe(nonBillableCategoryId);

    // Archive (soft-delete)
    const archiveResponse = await post(
      `/api/v1/non-billable-categories/${nonBillableCategoryId}/archive`,
      {},
    );
    expect(archiveResponse.status).toBe(200);

    // Verify the row is still in the database (soft-archived, not hard-deleted)
    const row = await env.DB_FIRM_POOL_1.prepare(
      `SELECT id, archived_at FROM ${NON_BILLABLE_CATEGORY_TABLE} WHERE id = ?1`,
    )
      .bind(nonBillableCategoryId)
      .first<{ id: string; archived_at: string | null }>();
    expect(row).not.toBeNull();
    expect(row?.archived_at).not.toBeNull();
  });

  it("returns 404 for an unknown category id on archive", async () => {
    const phantomId = "nonBillableCategory_000000000000000000000"; // valid shape (21-char token); no such row
    const response = await post(`/api/v1/non-billable-categories/${phantomId}/archive`, {});
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown category id on update (PATCH)", async () => {
    const phantomId = "nonBillableCategory_111111111111111111111"; // valid shape; no such row
    const response = await patch(`/api/v1/non-billable-categories/${phantomId}`, {
      name: "Ghost Category",
    });
    expect(response.status).toBe(404);
  });
});

describe("permission gate", () => {
  it("refuses a Read-only member the time:manageSettings capability (403)", async () => {
    const response = await post(
      "/api/v1/non-billable-categories",
      { name: "Denied" },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
