import { describe, it, expect } from "vitest";
import { insertCustomFieldStatement } from "../src/custom-field-statements.ts";
import { migratedFirmDatabase } from "./helpers.ts";

describe("insertCustomFieldStatement", () => {
  it("inserts a definition row that reads back", async () => {
    const db = await migratedFirmDatabase();
    await insertCustomFieldStatement(db, {
      id: "customField_abc" as Parameters<typeof insertCustomFieldStatement>[1]["id"],
      name: "Court Date",
      kind: "date",
      target: "matter",
      attachmentId: "matterType_pi",
      numberScale: null,
      required: 1,
      position: 3,
      templateFieldKey: null,
      createdAt: "2026-06-18T00:00:00.000Z",
      createdBy: "user_x",
    }).run();
    const { results } = await db
      .prepare("SELECT name, kind FROM custom_field WHERE id = 'customField_abc'")
      .all<{ name: string; kind: string }>();
    expect(results[0]).toEqual({ name: "Court Date", kind: "date" });
  });
});
