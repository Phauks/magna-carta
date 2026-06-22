import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { CustomFieldWriteOptions } from "../src/run-custom-field-effect.ts";

// createMigratedNodeDatabase is synchronous; wrap async so `await migratedFirmDatabase()` reads naturally.
export async function migratedFirmDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}
export function fixtureWriteOptions(seed = "cf-test"): CustomFieldWriteOptions {
  return {
    clock: { now: () => "2026-06-18T00:00:00.000Z" },
    actorUserId: null,
    randomSource: seededRandomSource(seed),
  };
}
