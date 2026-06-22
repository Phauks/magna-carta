import { describe, it, expect } from "vitest";
import { defineCustomField, hardDeleteCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { createPicklistOption } from "../src/picklist-option-service.ts";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { MAX_FIELDS_PER_SCOPE, MAX_OPTIONS_PER_FIELD } from "../src/limits.ts";

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
