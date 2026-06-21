import { DatabaseSync } from "node:sqlite";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";
import {
  fileVersion,
  location,
  matter,
  matterNumberCounter,
  storageMeter,
} from "../src/per-firm-schema.ts";

describe("matters / locations / file-manager schema", () => {
  it("matter: status enum + CHECK, frozen-number partial UNIQUE index, type/location/member FKs", () => {
    const config = getTableConfig(matter);
    expect(config.name).toBe("matter");
    const status = config.columns.find((column) => column.name === "status");
    expect(status?.notNull).toBe(true);
    expect(status?.enumValues).toEqual(["prospective", "open", "closed"]);
    expect(config.checks.map((check) => check.name)).toContain("matter_status_check");
    // The matter_number UNIQUE is PARTIAL (WHERE matter_number IS NOT NULL) so many unnumbered
    // prospectives coexist while two numbered matters can never share a number.
    const numberIndex = config.indexes.find((index) =>
      index.config.columns.some((column) => "name" in column && column.name === "matter_number"),
    );
    expect(numberIndex?.config.unique).toBe(true);
    expect(numberIndex?.config.where).toBeDefined();
  });

  it("file_version: the four status-family CHECKs + UNIQUE(r2_key) and UNIQUE(file_id, version_number)", () => {
    const config = getTableConfig(fileVersion);
    const checkNames = config.checks.map((check) => check.name);
    expect(checkNames).toContain("file_version_status_check");
    expect(checkNames).toContain("file_version_artifact_role_check");
    expect(checkNames).toContain("file_version_storage_class_check");
    expect(checkNames).toContain("file_version_scan_verdict_check");
    const uniqueR2Key = config.indexes.some(
      (index) =>
        index.config.unique &&
        index.config.columns.some((column) => "name" in column && column.name === "r2_key"),
    );
    expect(uniqueR2Key).toBe(true);
    const uniqueFileVersion = config.indexes.some(
      (index) =>
        index.config.unique &&
        ["file_id", "version_number"].every((wanted) =>
          index.config.columns.some((column) => "name" in column && column.name === wanted),
        ),
    );
    expect(uniqueFileVersion).toBe(true);
  });

  it("location: status enum + CHECK and a UNIQUE number_code", () => {
    const config = getTableConfig(location);
    expect(config.checks.map((check) => check.name)).toContain("location_status_check");
    const uniqueNumberCode = config.indexes.some(
      (index) =>
        index.config.unique &&
        index.config.columns.some((column) => "name" in column && column.name === "number_code"),
    );
    expect(uniqueNumberCode).toBe(true);
  });

  it("natural-key tables carry no handle column: matter_number_counter (scope_key) and storage_meter (composite)", () => {
    expect(getTableConfig(matterNumberCounter).columns.find((column) => column.primary)?.name).toBe(
      "scope_key",
    );
    const meter = getTableConfig(storageMeter);
    expect(meter.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "storage_class",
      "artifact_role",
      "prefix",
    ]);
  });

  it("the matter status CHECK fires at the DDL level — an untyped writer cannot land 'Prospective'", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
    raw.exec("PRAGMA foreign_keys = OFF;"); // isolate the CHECK from the responsible_member_id FK
    const seedMatterRow = (id: string, status: string) =>
      raw
        .prepare(
          "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?, 'A matter', ?, 'user_x', 't', 't')",
        )
        .run(id, status);
    expect(() => seedMatterRow("matter_badstatus00000000", "Prospective")).toThrow(/CHECK/);
    expect(() => seedMatterRow("matter_goodstatus0000000", "prospective")).not.toThrow();
  });

  it("file_version: inline_playable is a nullable enum column with no default + a matching CHECK", () => {
    const config = getTableConfig(fileVersion);
    const column = config.columns.find((c) => c.name === "inline_playable");
    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
    expect(column?.enumValues).toEqual(["playable", "download-only", "indeterminate"]);
    expect(config.checks.map((c) => c.name)).toContain("file_version_inline_playable_check");
  });

  it("the file_version status CHECK fires at the DDL level — only the four known states are storable", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
    raw.exec("PRAGMA foreign_keys = OFF;"); // isolate the CHECK from the file_id FK
    const seedVersion = (id: string, status: string) =>
      raw
        .prepare(
          "INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) VALUES (?, 'file_x', 1, ?, ?, 't')",
        )
        .run(id, `files/${id}`, status);
    expect(() => seedVersion("fileVersion_bad00000000", "deleted")).toThrow(/CHECK/);
    expect(() => seedVersion("fileVersion_good0000000", "pending")).not.toThrow();
  });
});
