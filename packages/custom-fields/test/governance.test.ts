import { describe, it, expect } from "vitest";
import { defineCustomField, hardDeleteCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { createPicklistOption } from "../src/picklist-option-service.ts";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { MAX_FIELDS_PER_SCOPE, MAX_OPTIONS_PER_FIELD } from "../src/limits.ts";

// A registered template version, reduced to the one column the guard reads: the field manifest its
// normalization produced. Written directly rather than through the document-assembly package, because
// this package depends on no other domain package and must not start now — the guard names the table by
// string exactly as the directory's merge names `custom_field_value`.
async function registerTemplateBinding(
  database: Awaited<ReturnType<typeof migratedFirmDatabase>>,
  boundKey: string,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO document_template (id, name, status, created_at, updated_at) VALUES ('documentTemplate_engagementLetter', 'Engagement letter', 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO document_template_version (id, template_id, version_number, r2_key, field_manifest_json, created_at) VALUES ('documentTemplateVersion_first', 'documentTemplate_engagementLetter', 1, 'templates/first.docx', ?1, '2026-08-05T00:00:00.000Z')`,
    )
    .bind(JSON.stringify({ fields: [{ key: boundKey, format: null, occurrences: 1 }] }))
    .run();
}

describe("hardDeleteCustomField", () => {
  it("refuses hard-delete once the field has any value (current or historical)", async () => {
    const db = await migratedFirmDatabase();
    const o = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "A", kind: "single-line", target: "matter", attachmentId: null },
      o,
    );
    await setCustomFieldValue(
      db,
      { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "x" } },
      o,
    );
    await expect(hardDeleteCustomField(db, { fieldId: customFieldId }, o)).rejects.toMatchObject({
      code: "field-in-use",
    });
  });

  it("refuses hard-delete of a field a document template binds, even with no values behind it", async () => {
    const db = await migratedFirmDatabase();
    const o = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Retainer cap", kind: "currency", target: "matter", attachmentId: null },
      o,
    );
    await registerTemplateBinding(db, `custom.${customFieldId}`);
    // Destroying the definition would leave every template naming it unable to assemble, against a
    // handle nobody could look up. Archive keeps the binding resolvable as a reported absence.
    await expect(hardDeleteCustomField(db, { fieldId: customFieldId }, o)).rejects.toMatchObject({
      code: "field-in-use",
    });
  });

  it("still hard-deletes a field no template binds, however many templates exist", async () => {
    const db = await migratedFirmDatabase();
    const o = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Unused", kind: "single-line", target: "matter", attachmentId: null },
      o,
    );
    // A template that binds a DIFFERENT field must not make this one undeletable.
    await registerTemplateBinding(db, "custom.customField_someOtherFieldXYZ");
    await hardDeleteCustomField(db, { fieldId: customFieldId }, o);
    const { results } = await db
      .prepare("SELECT 1 FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all();
    expect(results[0]).toBeUndefined();
  });

  it("hard-deletes a clean, unused field", async () => {
    const db = await migratedFirmDatabase();
    const o = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "A", kind: "single-line", target: "matter", attachmentId: null },
      o,
    );
    await hardDeleteCustomField(db, { fieldId: customFieldId }, o);
    const { results } = await db
      .prepare("SELECT 1 FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all();
    expect(results[0]).toBeUndefined();
  });
});

describe("defineCustomField caps", () => {
  it("enforces the per-scope field cap", async () => {
    const db = await migratedFirmDatabase();
    const o = fixtureWriteOptions();
    for (let n = 0; n < MAX_FIELDS_PER_SCOPE; n += 1) {
      await defineCustomField(
        db,
        { name: `f${n}`, kind: "single-line", target: "matter", attachmentId: "matterType_x" },
        o,
      );
    }
    await expect(
      defineCustomField(
        db,
        { name: "overflow", kind: "single-line", target: "matter", attachmentId: "matterType_x" },
        o,
      ),
    ).rejects.toMatchObject({ code: "too-many-fields-for-scope" });
  });
});

describe("createPicklistOption caps", () => {
  it("enforces the per-field options cap", async () => {
    const db = await migratedFirmDatabase();
    const o = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Status", kind: "picklist", target: "matter", attachmentId: null },
      o,
    );
    for (let n = 0; n < MAX_OPTIONS_PER_FIELD; n += 1) {
      await createPicklistOption(db, { fieldId: customFieldId, name: `opt${n}` }, o);
    }
    await expect(
      createPicklistOption(db, { fieldId: customFieldId, name: "overflow" }, o),
    ).rejects.toMatchObject({ code: "too-many-options-for-field" });
  });
});
