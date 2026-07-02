import {
  createMigratedNodeDatabase,
  type MigratedNodeDatabase,
} from "@magna-carta/database/node-sqlite";

export type LocalDatabase = MigratedNodeDatabase;

// An in-memory per-firm database at the CURRENT committed schema — the local/test stand-in for a
// firm's D1 (node-only; Miniflare/Workers contexts get the real D1 binding instead). The
// composition lives in @magna-carta/database (createMigratedNodeDatabase); this is the per-firm
// pin every fixture call site uses.
export function createLocalPerFirmDatabase(): LocalDatabase {
  return createMigratedNodeDatabase("per-firm");
}
