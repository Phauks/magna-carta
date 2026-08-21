import { it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { defineCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { previewConvert, applyConvert, CONVERT_INLINE_VALUE_LIMIT } from "../src/convert.ts";
import { readValueHistory, resolveCustomField } from "../src/reads.ts";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";

// The single current value stored for a field on a record, as the storage column holds it.
async function currentNumber(
  database: BatchDatabase,
  fieldId: string,
  targetRowId: string,
): Promise<number | null | undefined> {
  const { results } = await database
    .prepare(
      "SELECT value_number FROM custom_field_value WHERE field_id = ?1 AND target_row_id = ?2 AND is_current = 1",
    )
    .bind(fieldId, targetRowId)
    .all<{ value_number: number | null }>();
  return results[0]?.value_number;
}

async function currentKind(database: BatchDatabase, fieldId: string): Promise<string | undefined> {
  const resolved = await resolveCustomField(database, fieldId);
  return resolved.status === "absent" ? undefined : resolved.field.kind;
}

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
  const m1history = (await readValueHistory(db, customFieldId, "matter_1")).data;
  expect(m1history.length).toBe(2); // original text row + new number row
});

it("toRaw throws when the field kind is a reference kind (reference kinds are not convertible)", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Ref", kind: "contact-reference", target: "entity", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "entity_1",
      value: {
        kind: "reference",
        referenceId: "directoryPerson_abc",
        referenceKind: "contact-reference",
      },
    },
    o,
  );
  await expect(
    previewConvert(db, { fieldId: customFieldId, toKind: "single-line" }),
  ).rejects.toThrow("reference kinds are not convertible");
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

it("apply with block throws when any value needs-rule (unresolved), not only when parked", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Budget", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  // "500k" classifies as needs-rule (magnitude suffix), not parked — block must refuse it.
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_1",
      value: { kind: "text", text: "500k" },
    },
    o,
  );
  await expect(
    applyConvert(db, { fieldId: customFieldId, toKind: "number", parkedDisposition: "block" }, o),
  ).rejects.toMatchObject({ code: "convert-has-parked-values" });
});

// ── scale-crossing conversions ────────────────────────────────────────────────

it("currency to number and back keeps the amount's magnitude", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Settlement", kind: "currency", target: "matter", attachmentId: null },
    o,
  );
  // $500.00, stored the way the route hands it over: 50000 minor units.
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 50_000 } },
    o,
  );

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "number", parkedDisposition: "block" },
    o,
  );
  // A whole-unit count now: 500, not the raw 50000 that would read as a hundredfold larger figure.
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(500);
  expect(await currentKind(db, customFieldId)).toBe("number");

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "currency", parkedDisposition: "block" },
    o,
  );
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(50_000);
  expect(await currentKind(db, customFieldId)).toBe("currency");
});

it("number to currency re-expresses whole units as minor units", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Estimate", kind: "number", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 500 } },
    o,
  );

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "currency", parkedDisposition: "block" },
    o,
  );
  // $500.00 — not the $5.00 that leaving the stored integer untouched would mean.
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(50_000);
});

it("currency to number parks a value carrying cents, and the preview says so before apply runs", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Retainer", kind: "currency", target: "matter", attachmentId: null },
    o,
  );
  // $500.50 has no exact reading as a whole-unit count; $500.00 does.
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 50_050 } },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_2", value: { kind: "number", number: 50_000 } },
    o,
  );

  const preview = await previewConvert(db, { fieldId: customFieldId, toKind: "number" });
  expect(preview.clean).toBe(1);
  expect(preview.parked).toEqual([{ targetRowId: "matter_1" }]);

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "number", parkedDisposition: "park" },
    o,
  );
  expect(await currentNumber(db, customFieldId, "matter_1")).toBeUndefined();
  expect(await currentNumber(db, customFieldId, "matter_2")).toBe(500);
  // Nothing is lost: the parked value's original row endures as history.
  const history = (await readValueHistory(db, customFieldId, "matter_1")).data;
  expect(history.map((row) => row.valueNumber)).toEqual([50_050]);
});

it("text to currency reads the typed decimal at the money scale", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Quoted", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "1,234.56" } },
    o,
  );

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "currency", parkedDisposition: "block" },
    o,
  );
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(123_456);
});

it("currency to text renders the amount as a decimal, so converting back restores it", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Cap", kind: "currency", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 50_000 } },
    o,
  );

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "single-line", parkedDisposition: "block" },
    o,
  );
  const asText = await db
    .prepare(
      "SELECT value_text FROM custom_field_value WHERE field_id = ?1 AND target_row_id = 'matter_1' AND is_current = 1",
    )
    .bind(customFieldId)
    .all<{ value_text: string }>();
  expect(asText.results[0]?.value_text).toBe("500.00");

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "currency", parkedDisposition: "block" },
    o,
  );
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(50_000);
});

it("checkbox to currency scales the flag to the money scale", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Flagged", kind: "checkbox", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 1 } },
    o,
  );

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "currency", parkedDisposition: "block" },
    o,
  );
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(100);
});

it("a declared scale is honoured on both sides, so a same-scale retype moves no digits", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Rate", kind: "currency", target: "matter", attachmentId: null, numberScale: 4 },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "number", number: 12_345 } },
    o,
  );

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "number", parkedDisposition: "block" },
    o,
  );
  expect(await currentNumber(db, customFieldId, "matter_1")).toBe(12_345);
});

it("refuses to convert a reference-kind field with a typed refusal, values or no values", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Adviser", kind: "contact-reference", target: "entity", attachmentId: null },
    o,
  );
  // No values at all: the refusal is about the kind, not the data.
  await expect(
    previewConvert(db, { fieldId: customFieldId, toKind: "single-line" }),
  ).rejects.toMatchObject({ code: "reference-kind-not-convertible" });
  await expect(
    applyConvert(
      db,
      { fieldId: customFieldId, toKind: "single-line", parkedDisposition: "park" },
      o,
    ),
  ).rejects.toMatchObject({ code: "reference-kind-not-convertible" });

  // And nothing may be retyped INTO a reference kind either.
  const { customFieldId: textFieldId } = await defineCustomField(
    db,
    { name: "Notes", kind: "single-line", target: "entity", attachmentId: null },
    o,
  );
  await expect(
    previewConvert(db, { fieldId: textFieldId, toKind: "contact-reference" }),
  ).rejects.toMatchObject({ code: "reference-kind-not-convertible" });
});

it("refuses an inline convert of a field holding more values than one batch may carry", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Wide", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  // Written directly: what the guard counts is current rows, not how they were laid down.
  for (let index = 0; index <= CONVERT_INLINE_VALUE_LIMIT; index += 1) {
    await db
      .prepare(
        "INSERT INTO custom_field_value (id, field_id, target_row_id, value_text, is_current, valid_from, created_at) VALUES (?1, ?2, ?3, '1', 1, '2026-06-18T00:00:00.000Z', '2026-06-18T00:00:00.000Z')",
      )
      .bind(`customFieldValue_bulk${index}`, customFieldId, `matter_bulk${index}`)
      .run();
  }
  await expect(
    applyConvert(db, { fieldId: customFieldId, toKind: "number", parkedDisposition: "park" }, o),
  ).rejects.toMatchObject({ code: "convert-too-many-values" });
  // The preview is a read — it still answers, so an admin can see what they are up against.
  const preview = await previewConvert(db, { fieldId: customFieldId, toKind: "number" });
  expect(preview.clean).toBe(CONVERT_INLINE_VALUE_LIMIT + 1);
});
