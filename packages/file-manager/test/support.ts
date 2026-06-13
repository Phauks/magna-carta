import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";

export const clock = { now: () => "2026-06-13T12:00:00.000Z" };
export const now = () => clock.now();
export const ACTOR = "user_a" as UserId;
export const options = { clock, actorUserId: ACTOR };

export function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// A matter (and its responsible member) so folder/file FKs resolve.
export async function seedMatter(database: BatchDatabase): Promise<MatterId> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_a', 'A', 'active', '2026-01-01T00:00:00.000Z')",
    )
    .run();
  const matterId = "matter_a";
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'M', NULL, 'open', NULL, NULL, 'user_a', NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(matterId)
    .run();
  return matterId as MatterId;
}
