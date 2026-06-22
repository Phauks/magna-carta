import { it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { defineCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue, clearCustomFieldValue } from "../src/custom-field-value-service.ts";

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
