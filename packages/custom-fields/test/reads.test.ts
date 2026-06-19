import { it, expect } from "vitest";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";
import { defineCustomField, archiveCustomField } from "../src/custom-field-service.ts";
import { resolveCustomField, readCurrentValues } from "../src/reads.ts";
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
