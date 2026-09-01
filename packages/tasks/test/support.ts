import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FileId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";

// Shared scaffolding for the tasks package tests: a migrated in-memory per-firm database, a fixed
// clock, and the one-line commit every service test needs (the services return effects; the caller
// commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_taskTester0000" as UserId;
export const COLLEAGUE = "user_taskColleague0" as UserId;
export const DEPARTED = "user_taskDeparted00" as UserId;
export const MATTER = "matter_taskTest0000000000000000000" as MatterId;
export const OTHER_MATTER = "matter_taskOther000000000000000000" as MatterId;
export const CLOSED_MATTER = "matter_taskClosed00000000000000000" as MatterId;
export const HOLDING_MATTER = "matter_taskHolding00000000000000000" as MatterId;

export const clock = { now: () => "2026-09-01T12:00:00.000Z" };
export const visibility = visibleMatterPredicate();
export const options = { clock, actorUserId: ACTOR, visibility };
// The same options as a different member, for the paths where who is reading decides what they see.
export const colleagueOptions = { clock, actorUserId: COLLEAGUE, visibility };

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// Three members and four matters: an ordinary matter, a second to prove a filter does not leak
// across, a closed one for the "my tasks" filter, and the platform-owned custody holding matter,
// which carries a system key and must never appear on any read composing the visible-matter
// predicate.
export function seedFirm(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  const members: readonly [UserId, string, string][] = [
    [ACTOR, "Task Tester", "active"],
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
  const matters: readonly [MatterId, string, string, string | null][] = [
    [MATTER, "Herrera v Alvarez", "open", null],
    [OTHER_MATTER, "Brown estate", "open", null],
    [CLOSED_MATTER, "Nakamura sale", "closed", null],
    [HOLDING_MATTER, "Custody holdings", "open", "custody-holding"],
  ];
  for (const [id, title, status, systemKey] of matters) {
    const key = systemKey === null ? "NULL" : `'${systemKey}'`;
    raw.exec(
      `INSERT INTO matter (${matterColumns}) VALUES ('${id}', '${title}', '${status}', '${ACTOR}', ${key}, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    );
  }
}

// A live file on a matter, for the attachment paths. Only the columns the task's read touches are
// filled: a file's own suite covers the rest.
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
