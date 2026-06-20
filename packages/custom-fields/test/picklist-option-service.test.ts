import { describe, it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { defineCustomField } from "../src/custom-field-service.ts";
import {
  createPicklistOption,
  renamePicklistOption,
  reorderPicklistOption,
  archivePicklistOption,
  hardDeletePicklistOption,
} from "../src/picklist-option-service.ts";
describe("createPicklistOption", () => {
  it("creates an option keyed by identifier; rename does not change the id", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Filed" },
      options,
    );
    await renamePicklistOption(db, { optionId, name: "Filed with court" }, options);
    const { results } = await db
      .prepare("SELECT id, name FROM picklist_option WHERE id = ?1")
      .bind(optionId)
      .all<{ id: string; name: string }>();
    expect(results[0]).toEqual({ id: optionId, name: "Filed with court" });
  });

  it("writes a custom_field.option_created audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("create-option-audit");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Status", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Open" },
      options,
    );
    const { results } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.option_created'",
      )
      .bind(optionId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.option_created");
  });
});

describe("renamePicklistOption", () => {
  it("updates the name and writes a custom_field.option_renamed audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("rename-option");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Priority", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Low" },
      options,
    );
    await renamePicklistOption(db, { optionId, name: "High" }, options);
    const { results } = await db
      .prepare("SELECT name FROM picklist_option WHERE id = ?1")
      .bind(optionId)
      .all<{ name: string }>();
    expect(results[0]?.name).toBe("High");
    const { results: auditResults } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.option_renamed'",
      )
      .bind(optionId)
      .all<{ event: string }>();
    expect(auditResults[0]?.event).toBe("custom_field.option_renamed");
  });
});

describe("reorderPicklistOption", () => {
  it("updates the position and writes a custom_field.option_reordered audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("reorder-option");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Type", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Litigation" },
      options,
    );
    await reorderPicklistOption(db, { optionId, position: 3 }, options);
    const { results } = await db
      .prepare("SELECT position FROM picklist_option WHERE id = ?1")
      .bind(optionId)
      .all<{ position: number }>();
    expect(results[0]?.position).toBe(3);
    const { results: auditResults } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.option_reordered'",
      )
      .bind(optionId)
      .all<{ event: string }>();
    expect(auditResults[0]?.event).toBe("custom_field.option_reordered");
  });
});

describe("archivePicklistOption", () => {
  it("sets archived = 1 and writes a custom_field.option_archived audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("archive-option");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Resolution", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Settled" },
      options,
    );
    await archivePicklistOption(db, { optionId }, options);
    const { results } = await db
      .prepare("SELECT archived FROM picklist_option WHERE id = ?1")
      .bind(optionId)
      .all<{ archived: number }>();
    expect(results[0]?.archived).toBe(1);
    const { results: auditResults } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.option_archived'",
      )
      .bind(optionId)
      .all<{ event: string }>();
    expect(auditResults[0]?.event).toBe("custom_field.option_archived");
  });
});

describe("hardDeletePicklistOption", () => {
  it("deletes the option when it is not in use", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("hard-delete-ok");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Category", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Stale" },
      options,
    );
    await hardDeletePicklistOption(db, { optionId }, options);
    const { results } = await db
      .prepare("SELECT id FROM picklist_option WHERE id = ?1")
      .bind(optionId)
      .all<{ id: string }>();
    expect(results).toHaveLength(0);
    const { results: auditResults } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.option_deleted'",
      )
      .bind(optionId)
      .all<{ event: string }>();
    expect(auditResults[0]?.event).toBe("custom_field.option_deleted");
  });

  it("refuses hard-delete of an in-use option", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("hard-delete-in-use");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
      options,
    );
    const { optionId } = await createPicklistOption(
      db,
      { fieldId: customFieldId, name: "Filed" },
      options,
    );
    // Seed a custom_field_value row that references this option directly,
    // without depending on the value service (Task 7). The one_value_check constraint
    // requires exactly one value column to be non-null, so value_option_id is set
    // and the other value_* columns remain null.
    await db
      .prepare(
        `INSERT INTO custom_field_value (id, field_id, target_row_id, value_option_id, is_current, valid_from, created_at)
         VALUES ('customFieldValue_inuse01', ?1, 'matter_1', ?2, 1, 't', 't')`,
      )
      .bind(customFieldId, optionId)
      .run();
    await expect(hardDeletePicklistOption(db, { optionId }, options)).rejects.toMatchObject({
      code: "option-in-use",
    });
  });
});
