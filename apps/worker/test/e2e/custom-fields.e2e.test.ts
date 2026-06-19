import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "../support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "../support/test-auth.ts";

// Custom-fields capstone e2e: one ordered journey across the REAL HTTP surface over Miniflare
// bindings, composing every layer the slice built — definition, picklist options, the temporal
// values, the handle-stable rename, the non-destructive Convert, the directory-merge repoint +
// survivorship extension, archive, and the hard-delete guard. Each step asserts the HTTP status AND
// the resulting database state at the chokepoint, mirroring the unit and route tests but driving the
// full stack end to end. Every mutation rides an Idempotency-Key (the chokepoint requires one); the
// contact merge goes through the directory merge route, whose custom_field_value repoint targets are
// what this exercise proves work over the wire.

let firmId: FirmId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = (
    await seedFirm({ name: "Custom Fields E2E Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  // The directory merge route reads through the firm-scoped crypto context — seed the wrapped key.
  await seedFirmKey(firmId);

  const owner = await seedCredentialedUser("custom-fields-e2e-owner@example.com", {
    userName: "Custom Fields E2E Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Custom Fields E2E Owner");
  ownerCookie = await signInForSessionCookie("custom-fields-e2e-owner@example.com");
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
async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function del(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(cookie, true),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface ValueRow {
  readonly id: string;
  readonly fieldId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  readonly valueOptionId: string | null;
  readonly valueReferenceId: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
}

async function currentValues(targetRowId: string): Promise<ValueRow[]> {
  const response = await get(`/api/v1/custom-fields/records/${targetRowId}/values`);
  expect(response.status).toBe(200);
  return (await jsonOf<{ data: ValueRow[] }>(response)).data;
}

async function history(fieldId: string, targetRowId: string): Promise<ValueRow[]> {
  const response = await get(
    `/api/v1/custom-fields/fields/${fieldId}/records/${targetRowId}/history`,
  );
  expect(response.status).toBe(200);
  return (await jsonOf<{ data: ValueRow[] }>(response)).data;
}

describe("custom-fields e2e — full lifecycle over the HTTP surface", () => {
  // Handles carried across the ordered steps below.
  const ids: {
    stagePicklist?: string; // picklist on a matter type (rename, archive, hard-delete-refused)
    intakeOption?: string; // an option on the picklist
    adviserReference?: string; // contact-reference on an entity category (the repointed value)
    riskNotes?: string; // single-line on an entity category (the survivorship-absorbed owned value)
    estimate?: string; // single-line on a matter type (the Convert-to-currency subject)
    contactMaster?: string; // directory person — the merge master
    contactSubordinate?: string; // directory person — the merge subordinate
    referenceHolder?: string; // directory person whose record holds the contact-reference value
  } = {};

  const MATTER_ROW = "matter_e2e_capstone";

  async function defineField(body: unknown): Promise<string> {
    const response = await post("/api/v1/custom-fields/fields", body);
    expect(response.status).toBe(201);
    return (await jsonOf<{ id: string }>(response)).id;
  }

  it("1. defines a picklist and a contact-reference field on a matter type and an entity category", async () => {
    ids.stagePicklist = await defineField({
      name: "Matter Stage",
      kind: "picklist",
      target: "matter",
      attachmentId: null,
    });
    expect(ids.stagePicklist).toMatch(/^customField_/);

    const optionResponse = await post(`/api/v1/custom-fields/fields/${ids.stagePicklist}/options`, {
      name: "Intake",
    });
    expect(optionResponse.status).toBe(201);
    ids.intakeOption = (await jsonOf<{ id: string }>(optionResponse)).id;

    ids.adviserReference = await defineField({
      name: "Primary Adviser",
      kind: "contact-reference",
      target: "entity",
      attachmentId: null,
    });
    expect(ids.adviserReference).toMatch(/^customField_/);

    // An owned single-line value on entities, set on both contacts so the merge has a collision to
    // survivorship-absorb; and the single-line on a matter that the Convert step retypes to currency.
    ids.riskNotes = await defineField({
      name: "Risk Notes",
      kind: "single-line",
      target: "entity",
      attachmentId: null,
    });
    ids.estimate = await defineField({
      name: "Estimated Value",
      kind: "single-line",
      target: "matter",
      attachmentId: null,
    });

    // The resolve route reports the new picklist as active.
    const resolved = await get(`/api/v1/custom-fields/fields/${ids.stagePicklist}`);
    expect(resolved.status).toBe(200);
    expect((await jsonOf<{ status: string }>(resolved)).status).toBe("active");
  });

  it("2. sets values on a matter and on directory contacts (incl. a contact-reference)", async () => {
    // Two contacts to merge later, plus a record to hold the contact-reference value.
    const master = await post("/api/v1/directory/persons", { given: "Dana", family: "Okafor" });
    expect(master.status).toBe(201);
    ids.contactMaster = (await jsonOf<{ id: string }>(master)).id;
    expect(ids.contactMaster).toMatch(/^directoryPerson_/);

    const subordinate = await post("/api/v1/directory/persons", {
      given: "Dana",
      family: "Okaffor",
    });
    expect(subordinate.status).toBe(201);
    ids.contactSubordinate = (await jsonOf<{ id: string }>(subordinate)).id;

    const holder = await post("/api/v1/directory/persons", { given: "Lee", family: "Nakamura" });
    expect(holder.status).toBe(201);
    ids.referenceHolder = (await jsonOf<{ id: string }>(holder)).id;

    // The picklist value on the matter.
    const stageSet = await put("/api/v1/custom-fields/values", {
      fieldId: ids.stagePicklist,
      targetRowId: MATTER_ROW,
      value: { kind: "picklist", optionId: ids.intakeOption },
    });
    expect(stageSet.status).toBe(200);

    // The single-line estimate on the matter — a non-numeric string, so a later → currency Convert
    // has a value with no mechanical coercion (it parks).
    const estimateSet = await put("/api/v1/custom-fields/values", {
      fieldId: ids.estimate,
      targetRowId: MATTER_ROW,
      value: { kind: "text", text: "to be assessed" },
    });
    expect(estimateSet.status).toBe(200);

    // The owned single-line value on BOTH contacts (master + subordinate) — the merge collides them.
    for (const contact of [ids.contactMaster, ids.contactSubordinate]) {
      const noteSet = await put("/api/v1/custom-fields/values", {
        fieldId: ids.riskNotes,
        targetRowId: contact,
        value: { kind: "text", text: `note for ${contact}` },
      });
      expect(noteSet.status).toBe(200);
    }

    // The contact-reference value on the holder, pointing at the SUBORDINATE — the merge repoints it.
    const referenceSet = await put("/api/v1/custom-fields/values", {
      fieldId: ids.adviserReference,
      targetRowId: ids.referenceHolder,
      value: {
        kind: "reference",
        referenceId: ids.contactSubordinate,
        referenceKind: "contact-reference",
      },
    });
    expect(referenceSet.status).toBe(200);

    // The matter's current values now include the picklist option and the estimate text.
    const matterValues = await currentValues(MATTER_ROW);
    expect(
      matterValues.some(
        (v) => v.fieldId === ids.stagePicklist && v.valueOptionId === ids.intakeOption,
      ),
    ).toBe(true);
    expect(
      matterValues.some((v) => v.fieldId === ids.estimate && v.valueText === "to be assessed"),
    ).toBe(true);

    // The holder's contact-reference points at the subordinate.
    const holderValues = await currentValues(ids.referenceHolder!);
    expect(
      holderValues.some(
        (v) => v.fieldId === ids.adviserReference && v.valueReferenceId === ids.contactSubordinate,
      ),
    ).toBe(true);
  });

  it("3. renames a field — the stored value still resolves by its stable handle", async () => {
    const before = await currentValues(MATTER_ROW);
    const stageValueId = before.find((v) => v.fieldId === ids.stagePicklist)?.id;
    expect(stageValueId).toBeDefined();

    const renamed = await patch(`/api/v1/custom-fields/fields/${ids.stagePicklist}/name`, {
      name: "Lifecycle Stage",
    });
    expect(renamed.status).toBe(200);

    // The definition reports the new name; the handle is unchanged.
    const resolved = await get(`/api/v1/custom-fields/fields/${ids.stagePicklist}`);
    expect((await jsonOf<{ field: { name: string } | null }>(resolved)).field?.name).toBe(
      "Lifecycle Stage",
    );

    // The value binding is by handle, not by name — the same value row still resolves on the record.
    const after = await currentValues(MATTER_ROW);
    const stillThere = after.find((v) => v.fieldId === ids.stagePicklist);
    expect(stillThere?.id).toBe(stageValueId);
    expect(stillThere?.valueOptionId).toBe(ids.intakeOption);
  });

  it("4. converts a single-line field to currency with a parked value — no data loss, kind flipped", async () => {
    // The original text estimate cannot mechanically coerce to currency, so the preview parks it.
    const preview = await post(`/api/v1/custom-fields/fields/${ids.estimate}/convert/preview`, {
      toKind: "currency",
    });
    expect(preview.status).toBe(200);
    const previewBody = await jsonOf<{ clean: number; parked: { targetRowId: string }[] }>(preview);
    expect(previewBody.parked.some((p) => p.targetRowId === MATTER_ROW)).toBe(true);

    const apply = await post(`/api/v1/custom-fields/fields/${ids.estimate}/convert`, {
      toKind: "currency",
      parkedDisposition: "park",
    });
    expect(apply.status).toBe(200);

    // The field's kind flipped to currency.
    const kindRow = await env.DB_FIRM_POOL_1.prepare("SELECT kind FROM custom_field WHERE id = ?1")
      .bind(ids.estimate!)
      .first<{ kind: string }>();
    expect(kindRow?.kind).toBe("currency");

    // No data loss: the original text survives in history even though the current value is parked.
    const estimateHistory = await history(ids.estimate!, MATTER_ROW);
    expect(estimateHistory.some((v) => v.valueText === "to be assessed")).toBe(true);

    // The parked value reads as cleared from the record's current values.
    const current = await currentValues(MATTER_ROW);
    expect(current.some((v) => v.fieldId === ids.estimate)).toBe(false);
  });

  it("5. merges two contacts — the reference repoints, the owned value is absorbed, the alias resolves", async () => {
    const merge = await post("/api/v1/directory/merges", {
      masterId: ids.contactMaster,
      subordinateId: ids.contactSubordinate,
    });
    expect(merge.status).toBe(201);
    const mergeId = (await jsonOf<{ mergeId: string }>(merge)).mergeId;
    expect(mergeId).toMatch(/^entityMerge_/);

    // The contact-reference value on the holder now points at the MASTER (it was repointed).
    const holderValues = await currentValues(ids.referenceHolder!);
    expect(
      holderValues.some(
        (v) => v.fieldId === ids.adviserReference && v.valueReferenceId === ids.contactMaster,
      ),
    ).toBe(true);
    expect(holderValues.some((v) => v.valueReferenceId === ids.contactSubordinate)).toBe(false);

    // No custom_field_value still points at the subordinate (the reference repoint is complete).
    const danglingReference = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM custom_field_value WHERE value_reference_id = ?1",
    )
      .bind(ids.contactSubordinate!)
      .first<{ c: number }>();
    expect(danglingReference?.c).toBe(0);

    // The master keeps its own current Risk Notes value; the subordinate's owned value was absorbed
    // (moved onto the master and flipped to history) rather than discarded — field-level survivorship.
    const masterCurrent = await currentValues(ids.contactMaster!);
    const masterNote = masterCurrent.find((v) => v.fieldId === ids.riskNotes);
    expect(masterNote?.valueText).toBe(`note for ${ids.contactMaster}`);

    const masterHistory = await history(ids.riskNotes!, ids.contactMaster!);
    expect(masterHistory.some((v) => v.valueText === `note for ${ids.contactSubordinate}`)).toBe(
      true,
    );

    // No owned custom_field_value row still targets the subordinate (target_row_id repointed/absorbed).
    const danglingOwned = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM custom_field_value WHERE target_row_id = ?1",
    )
      .bind(ids.contactSubordinate!)
      .first<{ c: number }>();
    expect(danglingOwned?.c).toBe(0);

    // The merged-away contact still resolves to the master in duplicate detection (the alias endures).
    const candidates = await post("/api/v1/directory/duplicate-candidates", {
      kind: "person",
      given: "Dana",
      family: "Okaffor",
    });
    expect(candidates.status).toBe(200);
    const candidateBody = await jsonOf<{ data: { entityId: string }[] }>(candidates);
    expect(candidateBody.data.some((c) => c.entityId === ids.contactMaster)).toBe(true);
  });

  it("6. archives a field — its values are still readable", async () => {
    const archived = await post(`/api/v1/custom-fields/fields/${ids.stagePicklist}/archive`, {});
    expect(archived.status).toBe(200);

    // The definition reports archived; the resolve route still returns the field.
    const resolved = await get(`/api/v1/custom-fields/fields/${ids.stagePicklist}`);
    expect((await jsonOf<{ status: string }>(resolved)).status).toBe("archived");

    // The stored value endures and is still readable on the record.
    const current = await currentValues(MATTER_ROW);
    expect(
      current.some((v) => v.fieldId === ids.stagePicklist && v.valueOptionId === ids.intakeOption),
    ).toBe(true);
  });

  it("7. refuses a hard-delete of a field that has values — 409 field-in-use", async () => {
    const response = await del(`/api/v1/custom-fields/fields/${ids.stagePicklist}`);
    expect(response.status).toBe(409);
    const body = await jsonOf<{ type: string; detail: string }>(response);
    expect(body.type).toContain("conflict");

    // The field still exists — the refused delete changed nothing.
    const stillExists = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM custom_field WHERE id = ?1",
    )
      .bind(ids.stagePicklist!)
      .first<{ c: number }>();
    expect(stillExists?.c).toBe(1);
  });
});
