import { describe, expect, it } from "vitest";
import { defineCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { readCustomFieldValuesForScope, resolveCustomField } from "../src/reads.ts";
import { fixtureWriteOptions, migratedFirmDatabase } from "./helpers.ts";

// The matter-asset axis, end to end through the engine: a field is defined on it, stored, resolved
// back with its target intact, valued on an asset row, and scoped by the asset's class.
//
// The asset ids here are plain handles. This package holds no asset table and no foreign key to one
// — `target_row_id` has never referenced anything, on any axis, which is exactly why the third axis
// needed no schema change to carry it.
const HOUSE = "matterAsset_house00000000000000";
const CAR = "matterAsset_car0000000000000000";

describe("the matterAsset target", () => {
  it("defines, stores, and resolves a field on the asset axis", async () => {
    const database = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      database,
      {
        name: "Homeowners association",
        kind: "single-line",
        target: "matterAsset",
        attachmentId: null,
      },
      options,
    );

    const resolved = await resolveCustomField(database, customFieldId);
    expect(resolved.status).toBe("active");
    // The stored target survives the round trip as itself. Before the vocabulary widened, this
    // write went in and read back as a target no consumer recognised.
    expect(resolved.status === "active" && resolved.field.target).toBe("matterAsset");
  });

  it("holds a value against an asset row and reads it back on that row only", async () => {
    const database = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      database,
      { name: "Week number", kind: "number", target: "matterAsset", attachmentId: null },
      options,
    );
    await setCustomFieldValue(
      database,
      { fieldId: customFieldId, targetRowId: HOUSE, value: { kind: "number", number: 27 } },
      options,
    );

    const onTheHouse = await readCustomFieldValuesForScope(database, {
      target: "matterAsset",
      attachmentId: "realProperty",
      targetRowId: HOUSE,
    });
    expect(onTheHouse).toHaveLength(1);
    expect(onTheHouse[0]?.valueNumber).toBe(27);

    // The same field on a different asset is offered and unanswered — a row with null values, not
    // an absent row. The two states are what tell "nobody filled this in" from "not applicable".
    const onTheCar = await readCustomFieldValuesForScope(database, {
      target: "matterAsset",
      attachmentId: "vehicle",
      targetRowId: CAR,
    });
    expect(onTheCar).toHaveLength(1);
    expect(onTheCar[0]?.valueId).toBeNull();
    expect(onTheCar[0]?.valueNumber).toBeNull();
  });

  it("scopes a class-attached field to its own class, and an unattached field to every class", async () => {
    const database = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    await defineCustomField(
      database,
      { name: "Slip number", kind: "single-line", target: "matterAsset", attachmentId: "vehicle" },
      options,
    );
    await defineCustomField(
      database,
      { name: "Appraiser", kind: "single-line", target: "matterAsset", attachmentId: null },
      options,
    );

    const vehicleScope = await readCustomFieldValuesForScope(database, {
      target: "matterAsset",
      attachmentId: "vehicle",
      targetRowId: CAR,
    });
    expect(vehicleScope.map((field) => field.name).toSorted()).toEqual([
      "Appraiser",
      "Slip number",
    ]);

    const realPropertyScope = await readCustomFieldValuesForScope(database, {
      target: "matterAsset",
      attachmentId: "realProperty",
      targetRowId: HOUSE,
    });
    expect(realPropertyScope.map((field) => field.name)).toEqual(["Appraiser"]);
  });

  it("keeps the three axes apart — a matter field is not offered on an asset", async () => {
    const database = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    await defineCustomField(
      database,
      { name: "Referral source", kind: "single-line", target: "matter", attachmentId: null },
      options,
    );
    await defineCustomField(
      database,
      { name: "Preferred contact", kind: "single-line", target: "entity", attachmentId: null },
      options,
    );
    await defineCustomField(
      database,
      { name: "Appraiser", kind: "single-line", target: "matterAsset", attachmentId: null },
      options,
    );

    const assetScope = await readCustomFieldValuesForScope(database, {
      target: "matterAsset",
      attachmentId: "realProperty",
      targetRowId: HOUSE,
    });
    expect(assetScope.map((field) => field.name)).toEqual(["Appraiser"]);
  });

  it("excludes an archived asset field from the scope, as it does on every other axis", async () => {
    const database = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    const { customFieldId } = await defineCustomField(
      database,
      { name: "Retired", kind: "single-line", target: "matterAsset", attachmentId: null },
      options,
    );
    await setCustomFieldValue(
      database,
      { fieldId: customFieldId, targetRowId: HOUSE, value: { kind: "text", text: "kept" } },
      options,
    );
    await database
      .prepare("UPDATE custom_field SET archived = 1 WHERE id = ?1")
      .bind(customFieldId)
      .run();

    const scope = await readCustomFieldValuesForScope(database, {
      target: "matterAsset",
      attachmentId: "realProperty",
      targetRowId: HOUSE,
    });
    expect(scope).toHaveLength(0);

    // The value itself endures — archive withdraws the field, it does not erase what was recorded.
    const { results } = await database
      .prepare("SELECT value_text FROM custom_field_value WHERE field_id = ?1 AND is_current = 1")
      .bind(customFieldId)
      .all<{ value_text: string }>();
    expect(results[0]?.value_text).toBe("kept");
  });

  it("counts the asset axis under its own per-scope cap, not the matter axis's", async () => {
    const database = await migratedFirmDatabase();
    const options = fixtureWriteOptions();
    await defineCustomField(
      database,
      {
        name: "Same name different axis",
        kind: "single-line",
        target: "matter",
        attachmentId: null,
      },
      options,
    );
    await defineCustomField(
      database,
      {
        name: "Same name different axis",
        kind: "single-line",
        target: "matterAsset",
        attachmentId: null,
      },
      options,
    );
    // The cap counts `(target, attachment_id)` — the scope, not the firm — so a matter field has
    // never consumed an asset field's allowance and does not start now.
    const { results } = await database
      .prepare("SELECT target FROM custom_field ORDER BY target")
      .all<{ target: string }>();
    expect(results.map((row) => row.target)).toEqual(["matter", "matterAsset"]);
  });
});
