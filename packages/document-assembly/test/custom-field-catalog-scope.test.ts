import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { CUSTOM_FIELD_TARGETS } from "@magna-carta/custom-fields/types";
import { describe, expect, it } from "vitest";
import {
  selectCustomFieldCatalogStatement,
  type CustomFieldDefinitionColumns,
} from "../src/custom-field-statements.ts";

// The merge catalogue admits the MATTER axis and no other, and this is the test that holds the line
// as the target vocabulary grows.
//
// A `custom.<handle>` key is a scalar resolved against one target row, and the row an assembly has
// is the matter's. Admitting a field from any other axis would mint a key that appears in the field
// picker, binds cleanly at registration, and then resolves to an absence on every document ever
// assembled — the exact failure the catalogue's "a key that exists resolves" promise exists to
// prevent, and one nobody would trace back to a target filter.
//
// The loop below is the point: it is written over CUSTOM_FIELD_TARGETS rather than over a list of
// today's non-matter axes, so a fourth target added to the engine arrives here already covered and
// has to be argued for rather than leaking in.

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

type Database = ReturnType<typeof freshDatabase>;

async function defineField(
  database: Database,
  id: string,
  name: string,
  target: string,
  attachmentId: string | null,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO custom_field (id, name, kind, target, attachment_id, number_scale, required, archived, converting, position, template_field_key, created_at, created_by)
       VALUES (?1, ?2, 'single-line', ?3, ?4, NULL, 0, 0, 0, 0, NULL, '2026-08-16T00:00:00.000Z', NULL)`,
    )
    .bind(id, name, target, attachmentId)
    .run();
}

// A handle of the shape the identifiers package mints: the prefix plus twenty-one characters.
const handleFor = (letter: string) => `customField_${letter.repeat(21)}`;

describe("the merge catalogue's target scope", () => {
  it("returns the matter axis and excludes every other axis the engine offers", async () => {
    const database = freshDatabase();
    await defineField(database, handleFor("m"), "Referral source", "matter", null);
    for (const [index, target] of CUSTOM_FIELD_TARGETS.filter(
      (candidate) => candidate !== "matter",
    ).entries()) {
      await defineField(
        database,
        handleFor(String.fromCharCode(97 + index)),
        `Field on ${target}`,
        target,
        null,
      );
    }

    const { results } =
      await selectCustomFieldCatalogStatement(database).all<CustomFieldDefinitionColumns>();
    expect(results.map((row) => row.name)).toEqual(["Referral source"]);
  });

  it("excludes a matter-asset field however its class scope is set", async () => {
    const database = freshDatabase();
    // An asset field's values hang off one of a matter's MANY asset rows, so there is no single row
    // for a scalar key to resolve against — the class scope changes nothing about that.
    await defineField(database, handleFor("a"), "Appraiser", "matterAsset", null);
    await defineField(database, handleFor("b"), "Slip number", "matterAsset", "vehicle");

    const { results } =
      await selectCustomFieldCatalogStatement(database).all<CustomFieldDefinitionColumns>();
    expect(results).toHaveLength(0);
  });

  it("still excludes an archived matter field, so the two exclusions compose", async () => {
    const database = freshDatabase();
    await defineField(database, handleFor("m"), "Live", "matter", null);
    await defineField(database, handleFor("n"), "Withdrawn", "matter", null);
    await database
      .prepare("UPDATE custom_field SET archived = 1 WHERE id = ?1")
      .bind(handleFor("n"))
      .run();

    const { results } =
      await selectCustomFieldCatalogStatement(database).all<CustomFieldDefinitionColumns>();
    expect(results.map((row) => row.name)).toEqual(["Live"]);
  });
});
