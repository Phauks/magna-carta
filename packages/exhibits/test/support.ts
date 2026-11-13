import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FileId, FileVersionId, MatterId, UserId } from "@magna-carta/identifiers/types";

// Shared scaffolding: a migrated in-memory per-firm database, a fixed clock, and the commit every
// service test needs (the services return effects; a test that forgets to commit tests nothing).

export const ACTOR = "user_exhibitTester" as UserId;
export const MATTER = "matter_exhibitTest00000000000000000" as MatterId;
export const OTHER_MATTER = "matter_exhibitOther0000000000000000" as MatterId;

export const clock = { now: () => "2026-11-13T12:00:00.000Z" };
export const options = { clock, actorUserId: ACTOR };

export type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

export function migratedDatabase() {
  const migrated = createMigratedNodeDatabase("per-firm");
  seedMatters(migrated.raw);
  return migrated;
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

function seedMatters(raw: Raw): void {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Exhibit Tester', 'active', '2026-08-01T00:00:00.000Z')`,
  );
  const columns = "id, title, status, responsible_member_id, opened_at, created_at, updated_at";
  for (const [id, title] of [
    [MATTER, "Harrington v. Coastline Marine"],
    [OTHER_MATTER, "Brown divorce"],
  ] as const) {
    raw.exec(
      `INSERT INTO matter (${columns}) VALUES ('${id}', '${title}', 'open', '${ACTOR}', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    );
  }
}

let fileCounter = 0;

/**
 * A file on a matter with one version, clean unless told otherwise. Raw SQL, because no byte of a
 * document passes through this package: the File Manager's upload chokepoint is the only ingest.
 */
export function seedFile(
  raw: Raw,
  matterId: MatterId,
  name: string,
  status: "clean" | "pending" = "clean",
): { fileId: FileId; versionId: FileVersionId } {
  fileCounter += 1;
  const fileId = `file_exhibit${String(fileCounter).padStart(4, "0")}` as FileId;
  const versionId = `fileVersion_exhibit${String(fileCounter).padStart(4, "0")}` as FileVersionId;
  raw.exec(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES ('${fileId}', '${matterId}', '${name}', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
  );
  addVersion(raw, fileId, versionId, 1, status);
  return { fileId, versionId };
}

export function addVersion(
  raw: Raw,
  fileId: FileId,
  versionId: FileVersionId,
  versionNumber: number,
  status: "clean" | "pending" = "clean",
): void {
  raw.exec(
    `INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) VALUES ('${versionId}', '${fileId}', ${versionNumber}, 'r2/${versionId}', '${status}', '2026-02-01T00:00:00.000Z')`,
  );
  raw.exec(`UPDATE file SET current_version_id = '${versionId}' WHERE id = '${fileId}'`);
}
