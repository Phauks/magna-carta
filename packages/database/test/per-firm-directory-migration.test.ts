import { test, expect } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";

test("directory migration creates the node, name, edge, identifier and merge tables", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  for (const t of [
    "directory_person",
    "directory_organization",
    "directory_name",
    "directory_name_phonetic_code",
    "directory_identifier",
    "directory_edge",
    "directory_category",
    "directory_entity_category",
    "directory_email",
    "directory_phone",
    "directory_address",
    "directory_party_role",
    "matter_party",
    "entity_merge",
  ]) {
    expect(names, `table ${t} should exist`).toContain(t);
  }
  // FTS5 trigram virtual table exists and is queryable
  raw.prepare("INSERT INTO directory_name_fts(directory_name_fts) VALUES('integrity-check')").run();
});
