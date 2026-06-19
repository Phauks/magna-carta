import { it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { defineCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { previewConvert, applyConvert } from "../src/convert.ts";
import { readValueHistory, resolveCustomField } from "../src/reads.ts";

it("apply with park: coerces clean values, flips originals to history, clears parked, flips the kind", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Sum", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "4250000" } },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_2",
      value: { kind: "text", text: "approx five" },
    },
    o,
  );

  const preview = await previewConvert(db, { fieldId: customFieldId, toKind: "number" });
  expect(preview.clean).toBe(1);
  expect(preview.parked).toEqual([{ targetRowId: "matter_2" }]);

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "number", parkedDisposition: "park" },
    o,
  );

  const resolved = await resolveCustomField(db, customFieldId);
  expect(resolved.status === "absent" ? undefined : resolved.field.kind).toBe("number");
  const m1 = (
    await db
      .prepare(
        "SELECT value_number FROM custom_field_value WHERE target_row_id='matter_1' AND is_current=1",
      )
      .all<{ value_number: number }>()
  ).results[0];
  expect(m1?.value_number).toBe(4250000);
  const m2current = (
    await db
      .prepare(
        "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id='matter_2' AND is_current=1",
      )
      .all<{ n: number }>()
  ).results[0];
  expect(m2current?.n).toBe(0); // parked -> cleared, original preserved as history
  const m1history = await readValueHistory(db, customFieldId, "matter_1");
  expect(m1history.length).toBe(2); // original text row + new number row
});

it("apply with block throws when any value parks", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Sum", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_2",
      value: { kind: "text", text: "approx five" },
    },
    o,
  );
  await expect(
    applyConvert(db, { fieldId: customFieldId, toKind: "number", parkedDisposition: "block" }, o),
  ).rejects.toMatchObject({ code: "convert-has-parked-values" });
});
