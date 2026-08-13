import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { BatchSqlDatabase, SqlStatement } from "../src/sql.ts";

// Shared scaffolding: a control-plane database at the committed lineage head, plus the two rows the
// board's foreign keys need before anything can be written to it. The tests run against the REAL
// migration rather than a hand-built table, so a column this package writes and the migration never
// created fails here rather than in production.

export const FIRM_ONE = "firm_communityBoardOne" as FirmId;
export const FIRM_TWO = "firm_communityBoardTwo" as FirmId;
export const FIRM_THREE = "firm_communityBoardThree" as FirmId;

export interface CommunityTestDatabase {
  readonly database: BatchSqlDatabase;
  readonly raw: ReturnType<typeof createMigratedNodeDatabase>["raw"];
}

export function communityDatabase(): CommunityTestDatabase {
  const migrated = createMigratedNodeDatabase("control-plane");
  const database = migrated.database as unknown as BatchSqlDatabase;
  for (const firmId of [FIRM_ONE, FIRM_TWO, FIRM_THREE]) {
    migrated.raw.exec(
      `INSERT INTO firm (id, name, status, release_channel, firm_key_version, root_key_version, support_requires_cosign, data_region, created_at)
       VALUES ('${firmId}', '${firmId} name', 'active', 'stable', 1, 1, 0, 'us', '2026-08-01T00:00:00.000Z')`,
    );
  }
  return { database, raw: migrated.raw };
}

export function seedUser(
  test: CommunityTestDatabase,
  userId: UserId,
  firmId: FirmId,
  name: string,
): void {
  test.raw.exec(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, firm_id)
     VALUES ('${userId}', '${name}', '${userId}@example.test', 1, 0, 0, '${firmId}')`,
  );
}

// D1 runs a batch as one all-or-nothing transaction; so does the node adapter. Every multi-row write
// on this board goes through one, so the tests do too — a test that runs the statements one at a
// time is not exercising the path the worker takes.
export async function runBatch(
  database: BatchSqlDatabase,
  statements: SqlStatement[],
): Promise<void> {
  await database.batch(statements);
}
