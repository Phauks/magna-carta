import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FileId, MatterId, UserId } from "@magna-carta/identifiers/types";

// A migrated in-memory per-firm database with two matters, a fixed clock, and the commit every
// service test needs (the services return effects; a test that forgets to commit tests nothing).

export const ACTOR = "user_batesTester" as UserId;
export const MATTER = "matter_batesTest0000000000000000000" as MatterId;
export const OTHER_MATTER = "matter_batesOther000000000000000000" as MatterId;

export const clock = { now: () => "2026-11-19T12:00:00.000Z" };
export const options = { clock, actorUserId: ACTOR };

export type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

export function migratedDatabase() {
  const migrated = createMigratedNodeDatabase("per-firm");
  migrated.raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Bates Tester', 'active', '2026-08-01T00:00:00.000Z')`,
  );
  const columns = "id, title, status, responsible_member_id, opened_at, created_at, updated_at";
  for (const [id, title] of [
    [MATTER, "Harrington v. Coastline Marine"],
    [OTHER_MATTER, "Brown divorce"],
  ] as const) {
    migrated.raw.exec(
      `INSERT INTO matter (${columns}) VALUES ('${id}', '${title}', 'open', '${ACTOR}', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    );
  }
  return migrated;
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

let fileCounter = 0;

export function seedFile(raw: Raw, matterId: MatterId, name: string): FileId {
  fileCounter += 1;
  const fileId = `file_bates${String(fileCounter).padStart(4, "0")}` as FileId;
  raw.exec(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES ('${fileId}', '${matterId}', '${name}', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
  );
  return fileId;
}
