import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";

// Shared scaffolding for the matter-assets package tests: a migrated in-memory per-firm database, a
// fixed clock, and the one-line commit every service test needs (the services return effects; the
// caller commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_assetTester" as UserId;
export const MATTER = "matter_assetTest000000000000000000" as MatterId;
export const OTHER_MATTER = "matter_assetOther00000000000000000" as MatterId;

export const clock = { now: () => "2026-08-06T12:00:00.000Z" };
export const options = { clock, actorUserId: ACTOR };

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// Two matters, so a cross-matter refusal has something to be refused against.
export function seedMatters(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Asset Tester', 'active', '2026-08-01T00:00:00.000Z')`,
  );
  const matterColumns =
    "id, title, status, responsible_member_id, opened_at, created_at, updated_at";
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${MATTER}', 'Estate of Alvarez', 'open', '${ACTOR}', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${OTHER_MATTER}', 'Brown divorce', 'open', '${ACTOR}', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`,
  );
}

// A file in a matter, so the document-link path has a handle to link and a cross-matter one to
// refuse. Written with raw SQL because no byte of a document ever passes through this package: the
// File Manager's presigned upload and quarantine chokepoint is the only ingest there is.
export function seedFile(
  raw: ReturnType<typeof migratedDatabase>["raw"],
  fileId: string,
  matterId: string,
  name: string,
): void {
  raw.exec(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES ('${fileId}', '${matterId}', '${name}', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
  );
}
