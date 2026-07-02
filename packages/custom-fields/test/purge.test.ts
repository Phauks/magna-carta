import { it, expect } from "vitest";
import { purgeCustomField } from "../src/purge.ts";
import { migratedFirmDatabase, fixtureWriteOptions } from "./helpers.ts";

it("the purge seam refuses until a real erasure obligation enables it", async () => {
  const db = await migratedFirmDatabase();
  await expect(
    purgeCustomField(db, { fieldId: "customField_x", reason: "gdpr" }, fixtureWriteOptions()),
  ).rejects.toMatchObject({ code: "purge-not-yet-enabled" });
});
