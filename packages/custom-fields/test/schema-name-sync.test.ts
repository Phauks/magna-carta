import {
  customField,
  customFieldValue,
  picklistOption,
} from "@magna-carta/database/per-firm-schema";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD_KINDS, CUSTOM_FIELD_TARGETS, isCustomFieldTarget } from "../src/types.ts";

// Fitness function (the ledger pattern): the vocabularies this package declares must track
// @magna-carta/database's schema. The two closed lists on `custom_field` are written out in both
// places — the schema package cannot import a domain package that imports it — so this is the join
// that keeps them one fact.
//
// WHY A TARGET IS THE DANGEROUS ONE. `kind` fans out into the value columns and any mismatch fails
// loudly at the first write. A `target` mismatch does not: the column carries no CHECK, so a value
// the request schema accepts is stored happily and only goes wrong at the READS that filter on it,
// as a firm's field that exists, offers itself, and never resolves anywhere. Pinning the list is
// what turns that into a failing test instead of a support question.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  new Map(getTableConfig(table).columns.map((column) => [column.name, column]));

describe("schema name sync (custom-fields vocabularies pinned to @magna-carta/database)", () => {
  it("the three tables are named as this package's SQL names them", () => {
    expect(getTableConfig(customField).name).toBe("custom_field");
    expect(getTableConfig(picklistOption).name).toBe("picklist_option");
    expect(getTableConfig(customFieldValue).name).toBe("custom_field_value");
  });

  it("custom_field.target's schema enum is exactly CUSTOM_FIELD_TARGETS", () => {
    const target = columnsOf(customField).get("target");
    expect(target).toBeDefined();
    expect(target?.enumValues).toEqual([...CUSTOM_FIELD_TARGETS]);
  });

  it("custom_field.kind's schema enum is exactly CUSTOM_FIELD_KINDS", () => {
    const kind = columnsOf(customField).get("kind");
    expect(kind).toBeDefined();
    expect(kind?.enumValues).toEqual([...CUSTOM_FIELD_KINDS]);
  });

  it("the target vocabulary carries the three record axes, matter assets among them", () => {
    // Named literally rather than derived from the constant: a test that reads the constant it is
    // checking would pass for an empty list, and this one exists to state which axes ship.
    expect([...CUSTOM_FIELD_TARGETS]).toEqual(["matter", "entity", "matterAsset"]);
    expect(isCustomFieldTarget("matterAsset")).toBe(true);
    expect(isCustomFieldTarget("custodyPacket")).toBe(false);
  });
});
