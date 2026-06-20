import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
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

// Slice 1·4 custom-fields route surface, driven through the chokepoint over real Miniflare bindings:
// defining a field, setting/clearing a value, picklist options, the convert preview/apply, and the
// reads (resolve, current values, history). Asserts the happy paths, the reference-kind handle
// mismatch maps to 422, and that a Read-only member is refused a mutation (the chokepoint gate).

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;

// Mirror a member carrying a named seeded role (the Read-only role grants no custom-fields permission).
async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({ name: "Custom Fields Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("custom-fields-owner@example.com", {
    userName: "Custom Fields Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Custom Fields Owner");
  ownerCookie = await signInForSessionCookie("custom-fields-owner@example.com");

  const readOnly = await seedCredentialedUser("custom-fields-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("custom-fields-readonly@example.com");
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function put(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function del(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function defineField(body: unknown): Promise<string> {
  const response = await post("/api/v1/custom-fields/fields", body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe("custom-fields field routes", () => {
  it("defines a field and sets a value", async () => {
    const fieldId = await defineField({
      name: "Court Date",
      kind: "date",
      target: "matter",
      attachmentId: null,
    });

    const set = await put("/api/v1/custom-fields/values", {
      fieldId,
      targetRowId: "matter_1",
      value: { kind: "date", date: "2026-09-18" },
    });
    expect(set.status).toBe(200);

    // The record's current values include the date just set.
    const values = await get("/api/v1/custom-fields/records/matter_1/values");
    expect(values.status).toBe(200);
    const body = (await values.json()) as { data: { fieldId: string; valueDate: string | null }[] };
    expect(body.data.some((v) => v.fieldId === fieldId && v.valueDate === "2026-09-18")).toBe(true);
  });

  it("scales a currency input by the field's number_scale into an integer", async () => {
    const fieldId = await defineField({
      name: "Settlement Amount",
      kind: "currency",
      target: "matter",
      attachmentId: null,
      numberScale: 2,
    });
    const set = await put("/api/v1/custom-fields/values", {
      fieldId,
      targetRowId: "matter_money",
      value: { kind: "number", number: 1234.56 },
    });
    expect(set.status).toBe(200);
    const stored = await env.DB_FIRM_POOL_1.prepare(
      "SELECT value_number FROM custom_field_value WHERE field_id = ?1 AND is_current = 1",
    )
      .bind(fieldId)
      .first<{ value_number: number }>();
    expect(stored?.value_number).toBe(123456);
  });

  it("clears a value (DELETE)", async () => {
    const fieldId = await defineField({
      name: "Clearable",
      kind: "single-line",
      target: "matter",
      attachmentId: null,
    });
    await put("/api/v1/custom-fields/values", {
      fieldId,
      targetRowId: "matter_clear",
      value: { kind: "text", text: "to be cleared" },
    });
    const cleared = await del("/api/v1/custom-fields/values", {
      fieldId,
      targetRowId: "matter_clear",
    });
    expect(cleared.status).toBe(200);
    const values = await get("/api/v1/custom-fields/records/matter_clear/values");
    const body = (await values.json()) as { data: { fieldId: string }[] };
    expect(body.data.some((v) => v.fieldId === fieldId)).toBe(false);
  });

  it("resolves a field handle to its definition", async () => {
    const fieldId = await defineField({
      name: "Resolvable",
      kind: "single-line",
      target: "matter",
      attachmentId: null,
    });
    const resolved = await get(`/api/v1/custom-fields/fields/${fieldId}`);
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as { status: string; field: { name: string } | null };
    expect(body.status).toBe("active");
    expect(body.field?.name).toBe("Resolvable");
  });

  it("creates, lists, and reads value history through picklist options and convert", async () => {
    const fieldId = await defineField({
      name: "Stage",
      kind: "picklist",
      target: "matter",
      attachmentId: null,
    });
    const optionResponse = await post(`/api/v1/custom-fields/fields/${fieldId}/options`, {
      name: "Intake",
    });
    expect(optionResponse.status).toBe(201);
    const optionId = ((await optionResponse.json()) as { id: string }).id;

    await put("/api/v1/custom-fields/values", {
      fieldId,
      targetRowId: "matter_history",
      value: { kind: "picklist", optionId },
    });
    // Convert the picklist to free text — the preview reports the value counts.
    const preview = await post(`/api/v1/custom-fields/fields/${fieldId}/convert/preview`, {
      toKind: "single-line",
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { clean: number };
    expect(previewBody.clean).toBeGreaterThanOrEqual(1);

    const apply = await post(`/api/v1/custom-fields/fields/${fieldId}/convert`, {
      toKind: "single-line",
      parkedDisposition: "park",
    });
    expect(apply.status).toBe(200);

    const history = await get(
      `/api/v1/custom-fields/fields/${fieldId}/records/matter_history/history`,
    );
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as { data: unknown[] };
    expect(historyBody.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("custom-fields error mapping", () => {
  it("maps a reference-kind handle mismatch to 422", async () => {
    const fieldId = await defineField({
      name: "Related Contact",
      kind: "contact-reference",
      target: "matter",
      attachmentId: null,
    });
    // A contact-reference field given a matter_ handle: the service refuses it.
    const set = await put("/api/v1/custom-fields/values", {
      fieldId,
      targetRowId: "matter_ref",
      value: { kind: "reference", referenceId: "matter_123", referenceKind: "contact-reference" },
    });
    expect(set.status).toBe(422);
    const body = (await set.json()) as { type: string };
    expect(body.type).toContain("validation");
  });

  it("maps an unknown field on convert preview to 404", async () => {
    // A well-formed-but-absent custom-field handle (21-char suffix) — passes the param pattern, so it
    // reaches the handler, where the convert read raises unknown-field.
    const absentHandle = `customField_${"a".repeat(21)}`;
    const unknown = await post(`/api/v1/custom-fields/fields/${absentHandle}/convert/preview`, {
      toKind: "single-line",
    });
    expect(unknown.status).toBe(404);
  });

  it("refuses purge with 409 (not yet enabled)", async () => {
    const fieldId = await defineField({
      name: "Purgeable",
      kind: "single-line",
      target: "matter",
      attachmentId: null,
    });
    const purge = await post(`/api/v1/custom-fields/fields/${fieldId}/purge`, {
      reason: "test erasure",
    });
    expect(purge.status).toBe(409);
  });
});

describe("custom-fields permission enforcement", () => {
  it("refuses a Read-only member the define-field capability (403)", async () => {
    const response = await post(
      "/api/v1/custom-fields/fields",
      { name: "Denied", kind: "single-line", target: "matter", attachmentId: null },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
