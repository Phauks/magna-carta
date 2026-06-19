import { describe, it, expect } from "vitest";
import {
  defineCustomField,
  renameCustomField,
  archiveCustomField,
  unarchiveCustomField,
  setCustomFieldRequired,
  reorderCustomField,
} from "../src/custom-field-service.ts";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";

describe("defineCustomField", () => {
  it("defines a field, then renames it without touching the kind or id", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Court Date", kind: "date", target: "matter", attachmentId: "matterType_pi" },
      options,
    );
    await renameCustomField(db, { fieldId: customFieldId, name: "Hearing Date" }, options);
    const { results } = await db
      .prepare("SELECT name, kind FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all<{ name: string; kind: string }>();
    expect(results[0]).toEqual({ name: "Hearing Date", kind: "date" });
  });

  it("writes a custom_field.defined audit event on define", async () => {
    const db = await migratedFirmDatabase();
    const { customFieldId } = await defineCustomField(
      db,
      { name: "X", kind: "single-line", target: "entity", attachmentId: null },
      fixtureWriteOptions(),
    );
    const { results } = await db
      .prepare("SELECT event, subject_id FROM audit_log WHERE subject_id = ?1")
      .bind(customFieldId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.defined");
  });

  it("returns idempotentReplay: false on a fresh define", async () => {
    const db = await migratedFirmDatabase();
    const result = await defineCustomField(
      db,
      { name: "Fresh", kind: "checkbox", target: "matter", attachmentId: null },
      fixtureWriteOptions("fresh-seed"),
    );
    expect(result.idempotentReplay).toBe(false);
  });
});

describe("renameCustomField", () => {
  it("writes a custom_field.renamed audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("rename-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Old Name", kind: "single-line", target: "matter", attachmentId: null },
      options,
    );
    await renameCustomField(db, { fieldId: customFieldId, name: "New Name" }, options);
    const { results } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.renamed'",
      )
      .bind(customFieldId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.renamed");
  });
});

describe("archiveCustomField / unarchiveCustomField", () => {
  it("archives a field and sets archived = 1", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("archive-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Archivable", kind: "date", target: "matter", attachmentId: null },
      options,
    );
    await archiveCustomField(db, { fieldId: customFieldId }, options);
    const { results } = await db
      .prepare("SELECT archived FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all<{ archived: number }>();
    expect(results[0]?.archived).toBe(1);
  });

  it("writes a custom_field.archived audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("archive-audit-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "AuditArchive", kind: "date", target: "matter", attachmentId: null },
      options,
    );
    await archiveCustomField(db, { fieldId: customFieldId }, options);
    const { results } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.archived'",
      )
      .bind(customFieldId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.archived");
  });

  it("unarchives a field and sets archived = 0", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("unarchive-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "UnArchivable", kind: "date", target: "matter", attachmentId: null },
      options,
    );
    await archiveCustomField(db, { fieldId: customFieldId }, options);
    await unarchiveCustomField(db, { fieldId: customFieldId }, options);
    const { results } = await db
      .prepare("SELECT archived FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all<{ archived: number }>();
    expect(results[0]?.archived).toBe(0);
  });

  it("writes a custom_field.unarchived audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("unarchive-audit-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "AuditUnarchive", kind: "date", target: "matter", attachmentId: null },
      options,
    );
    await archiveCustomField(db, { fieldId: customFieldId }, options);
    await unarchiveCustomField(db, { fieldId: customFieldId }, options);
    const { results } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.unarchived'",
      )
      .bind(customFieldId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.unarchived");
  });
});

describe("setCustomFieldRequired", () => {
  it("sets required = 1 on a field", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("required-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Optional Field", kind: "single-line", target: "matter", attachmentId: null },
      options,
    );
    await setCustomFieldRequired(db, { fieldId: customFieldId, required: 1 }, options);
    const { results } = await db
      .prepare("SELECT required FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all<{ required: number }>();
    expect(results[0]?.required).toBe(1);
  });

  it("writes a custom_field.required_changed audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("required-audit-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "RequiredAudit", kind: "single-line", target: "matter", attachmentId: null },
      options,
    );
    await setCustomFieldRequired(db, { fieldId: customFieldId, required: 1 }, options);
    const { results } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.required_changed'",
      )
      .bind(customFieldId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.required_changed");
  });
});

describe("reorderCustomField", () => {
  it("updates position on a field", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("reorder-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "Reorderable", kind: "date", target: "matter", attachmentId: null },
      options,
    );
    await reorderCustomField(db, { fieldId: customFieldId, position: 5 }, options);
    const { results } = await db
      .prepare("SELECT position FROM custom_field WHERE id = ?1")
      .bind(customFieldId)
      .all<{ position: number }>();
    expect(results[0]?.position).toBe(5);
  });

  it("writes a custom_field.reordered audit event", async () => {
    const db = await migratedFirmDatabase();
    const options = fixtureWriteOptions("reorder-audit-test");
    const { customFieldId } = await defineCustomField(
      db,
      { name: "ReorderAudit", kind: "date", target: "matter", attachmentId: null },
      options,
    );
    await reorderCustomField(db, { fieldId: customFieldId, position: 3 }, options);
    const { results } = await db
      .prepare(
        "SELECT event FROM audit_log WHERE subject_id = ?1 AND event = 'custom_field.reordered'",
      )
      .bind(customFieldId)
      .all<{ event: string }>();
    expect(results[0]?.event).toBe("custom_field.reordered");
  });
});
