import { it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { archiveCustomField, defineCustomField } from "../src/custom-field-service.ts";
import { archivePicklistOption, createPicklistOption } from "../src/picklist-option-service.ts";
import { setCustomFieldValue, clearCustomFieldValue } from "../src/custom-field-value-service.ts";
import { MAX_VALUE_TEXT_LENGTH } from "../src/limits.ts";
import type { CustomFieldId } from "@magna-carta/identifiers/types";

it("set then edit keeps exactly one current row and flips the prior to history", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Court Date", kind: "date", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_1",
      value: { kind: "date", date: "2026-09-18" },
    },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_1",
      value: { kind: "date", date: "2026-09-25" },
    },
    o,
  );
  const current = await db
    .prepare(
      "SELECT value_date FROM custom_field_value WHERE target_row_id='matter_1' AND field_id=?1 AND is_current=1",
    )
    .bind(customFieldId)
    .all<{ value_date: string }>();
  expect(current.results).toEqual([{ value_date: "2026-09-25" }]);
  const history = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id='matter_1' AND field_id=?1 AND is_current=0",
    )
    .bind(customFieldId)
    .all<{ n: number }>();
  expect(history.results[0]?.n).toBe(1);
});

it("rejects a contact-reference value whose handle is a matter", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Carrier", kind: "contact-reference", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "reference", referenceId: "matter_9", referenceKind: "contact-reference" },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "reference-kind-handle-mismatch" });
});

it("clear flips the current row to history and leaves no current row", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Note", kind: "single-line", target: "entity", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "directoryPerson_1",
      value: { kind: "text", text: "vip" },
    },
    o,
  );
  await clearCustomFieldValue(db, { fieldId: customFieldId, targetRowId: "directoryPerson_1" }, o);
  const current = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id='directoryPerson_1' AND field_id=?1 AND is_current=1",
    )
    .bind(customFieldId)
    .all<{ n: number }>();
  expect(current.results[0]?.n).toBe(0);
});

// ── what the field's definition refuses ───────────────────────────────────────

it("refuses a value for a field that does not exist instead of writing an orphan row", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const absentFieldId = `customField_${"a".repeat(21)}` as CustomFieldId;
  await expect(
    setCustomFieldValue(
      db,
      { fieldId: absentFieldId, targetRowId: "matter_1", value: { kind: "text", text: "orphan" } },
      o,
    ),
  ).rejects.toMatchObject({ code: "unknown-field" });
  const rows = await db
    .prepare("SELECT COUNT(*) AS n FROM custom_field_value")
    .all<{ n: number }>();
  expect(rows.results[0]?.n).toBe(0);
});

it("refuses a value whose shape disagrees with the field's kind", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Settlement", kind: "currency", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "text", text: "a lot of money" },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "value-kind-mismatch" });
});

it("refuses a reference value whose kind is not the field's reference kind", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Related Matter", kind: "matter-reference", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: {
          kind: "reference",
          referenceId: "directoryPerson_1",
          referenceKind: "contact-reference",
        },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "value-kind-mismatch" });
});

it("refuses a fractional number: value_number holds whole minor units, never a float", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Settlement", kind: "currency", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 12.34 } },
      o,
    ),
  ).rejects.toMatchObject({ code: "value-not-a-scaled-integer" });
});

it("refuses a checkbox value that is neither set nor unset", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Conflict Cleared", kind: "checkbox", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 7 } },
      o,
    ),
  ).rejects.toMatchObject({ code: "value-kind-mismatch" });
});

it("refuses a write to an archived field", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Retired", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await archiveCustomField(db, { fieldId: customFieldId }, o);
  await expect(
    setCustomFieldValue(
      db,
      { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "late" } },
      o,
    ),
  ).rejects.toMatchObject({ code: "field-archived" });
});

it("refuses a picklist value naming an option that is absent or belongs to another field", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
    o,
  );
  const { customFieldId: otherFieldId } = await defineCustomField(
    db,
    { name: "Priority", kind: "picklist", target: "matter", attachmentId: null },
    o,
  );
  const { optionId: otherFieldOption } = await createPicklistOption(
    db,
    { fieldId: otherFieldId, name: "Urgent" },
    o,
  );

  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "picklist", optionId: "picklistOption_nonexistent" },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "unknown-picklist-option" });

  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "picklist", optionId: otherFieldOption },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "unknown-picklist-option" });
});

it("refuses a picklist value naming an archived option", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
    o,
  );
  const { optionId } = await createPicklistOption(
    db,
    { fieldId: customFieldId, name: "Intake" },
    o,
  );
  await archivePicklistOption(db, { optionId }, o);
  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "picklist", optionId },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "picklist-option-archived" });
});

it("refuses a text value past the per-value ceiling", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Notes", kind: "multi-line", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "text", text: "x".repeat(MAX_VALUE_TEXT_LENGTH + 1) },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "value-text-too-long" });
});

it("accepts a live option on its own field, and a scaled integer on a currency field", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId: picklistFieldId } = await defineCustomField(
    db,
    { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
    o,
  );
  const { optionId } = await createPicklistOption(
    db,
    { fieldId: picklistFieldId, name: "Intake" },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: picklistFieldId, targetRowId: "matter_1", value: { kind: "picklist", optionId } },
    o,
  );

  const { customFieldId: currencyFieldId } = await defineCustomField(
    db,
    { name: "Settlement", kind: "currency", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: currencyFieldId,
      targetRowId: "matter_1",
      value: { kind: "number", number: 123_456 },
    },
    o,
  );

  const stored = await db
    .prepare(
      "SELECT value_option_id, value_number FROM custom_field_value WHERE target_row_id='matter_1' AND is_current=1 ORDER BY field_id",
    )
    .all<{ value_option_id: string | null; value_number: number | null }>();
  expect(stored.results).toHaveLength(2);
  expect(stored.results.some((row) => row.value_option_id === optionId)).toBe(true);
  expect(stored.results.some((row) => row.value_number === 123_456)).toBe(true);
});
