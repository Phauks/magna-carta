import { DatabaseSync } from "node:sqlite";
import {
  type NodeBatchDatabase,
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";

export interface LocalDatabase {
  readonly database: NodeBatchDatabase; // D1-shaped; feed to the domain services + commitEffectBatch
  readonly raw: DatabaseSync; // escape hatch for assertions / deliberate corruption in tests
}

// An in-memory per-firm database at the CURRENT committed schema — the local/test stand-in for a
// firm's D1 (node-only; Miniflare/Workers contexts get the real D1 binding instead).
export function createLocalPerFirmDatabase(): LocalDatabase {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return { database: nodeSqliteBatchDatabase(raw), raw };
}
