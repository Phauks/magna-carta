import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FileId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";

// Shared scaffolding for the notes package tests: a migrated in-memory per-firm database, a fixed
// clock, and the one-line commit every service test needs (the services return effects; the caller
// commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_noteTester0000" as UserId;
export const COLLEAGUE = "user_noteColleague0" as UserId;
export const DEPARTED = "user_noteDeparted00" as UserId;
export const MATTER = "matter_noteTest0000000000000000000" as MatterId;
export const OTHER_MATTER = "matter_noteOther000000000000000000" as MatterId;
export const HOLDING_MATTER = "matter_noteHolding00000000000000000" as MatterId;

export const clock = { now: () => "2026-08-31T12:00:00.000Z" };
export const visibility = visibleMatterPredicate();
export const options = { clock, actorUserId: ACTOR, visibility };

// A clock that advances a second per read, for the paths where two rows must not share an instant.
export function tickingClock(start = Date.parse("2026-08-31T12:00:00.000Z")) {
  let current = start;
  return {
    now: () => {
      current += 1000;
      return new Date(current).toISOString();
    },
  };
}

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// Three members and three matters: an ordinary matter, a second one to prove a filter does not
// leak across, and the platform-owned custody holding matter, which carries a system key and must
// never appear on any read composing the visible-matter predicate.
export function seedFirm(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  const members: readonly [UserId, string, string][] = [
    [ACTOR, "Note Tester", "active"],
    [COLLEAGUE, "A Colleague", "active"],
    [DEPARTED, "Sarah Chen", "deactivated"],
  ];
  for (const [userId, displayName, status] of members) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${userId}', '${displayName}', '${status}', '2026-08-01T00:00:00.000Z')`,
    );
  }
  const matterColumns =
    "id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at";
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${MATTER}', 'Herrera v Alvarez', 'open', '${ACTOR}', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${OTHER_MATTER}', 'Brown estate', 'open', '${ACTOR}', NULL, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${HOLDING_MATTER}', 'Custody holdings', 'open', '${ACTOR}', 'custody-holding', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z')`,
  );
}

// A live file on a matter, for the attachment paths. Only the columns the note's read touches are
// filled: a file's own suite covers the rest, and inventing values here would be a second opinion
// about a shape that already has one.
export function seedFile(
  raw: ReturnType<typeof migratedDatabase>["raw"],
  matterId: MatterId,
  name: string,
): FileId {
  const fileId = `file_${name
    .replace(/[^a-zA-Z0-9]/gu, "")
    .padEnd(21, "0")
    .slice(0, 21)}` as FileId;
  raw.exec(
    `INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at) VALUES ('${fileId}', '${matterId}', '${name}', 'idle', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  );
  return fileId;
}
