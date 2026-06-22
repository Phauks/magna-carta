import { it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { defineCustomField, archiveCustomField } from "../src/custom-field-service.ts";
import { resolveCustomField, readCurrentValues, readValueHistory } from "../src/reads.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";

it("resolves active, archived, and absent fields", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "A", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  expect((await resolveCustomField(db, customFieldId)).status).toBe("active");
  await archiveCustomField(db, { fieldId: customFieldId }, o);
  expect((await resolveCustomField(db, customFieldId)).status).toBe("archived");
  expect((await resolveCustomField(db, "customField_missing")).status).toBe("absent");
});

it("readCurrentValues returns one row per field for a record", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "A", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "v1" } },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "v2" } },
    o,
  );
  const rows = await readCurrentValues(db, "matter_1");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.valueText).toBe("v2");
});

it("readValueHistory returns all rows for a field+record ordered oldest-first by valid_from, with no is_current filter", async () => {
  const db = await migratedFirmDatabase();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "B", kind: "single-line", target: "matter", attachmentId: null },
    fixtureWriteOptions("cf-hist-def"),
  );
  // Write v1 at an earlier timestamp so ORDER BY valid_from puts it first.
  const oV1 = {
    ...fixtureWriteOptions("cf-hist-v1"),
    clock: { now: () => "2026-06-18T00:00:00.000Z" },
  };
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "v1" } },
    oV1,
  );
  // Write v2 at a later timestamp so it becomes the current row; v1 flips to history.
  const oV2 = {
    ...fixtureWriteOptions("cf-hist-v2"),
    clock: { now: () => "2026-06-18T01:00:00.000Z" },
  };
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "v2" } },
    oV2,
  );
  // readValueHistory returns both rows (no is_current filter) oldest-first.
  const history = await readValueHistory(db, customFieldId, "matter_1");
  expect(history.length).toBe(2);
  expect(history[0]?.valueText).toBe("v1");
  expect(history[1]?.valueText).toBe("v2");
});
