import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";

// Shared scaffolding for the In/Out Log tests: a migrated in-memory per-firm database, a clock that
// moves a second per read so two entries never share an instant, and the one-line commit every
// service test needs (the services return effects; a test that forgets to commit tests nothing).

export const ACTOR = "user_inOutDesk00000" as UserId;
export const LAWYER = "user_inOutLawyer000" as UserId;
export const MATTER = "matter_inOutTest000000000000000000" as MatterId;
export const HOLDING_MATTER = "matter_inOutHolding000000000000000" as MatterId;

export function tickingClock(start = Date.parse("2026-11-19T17:00:00.000Z")) {
  let current = start;
  return {
    now: () => {
      current += 1000;
      return new Date(current).toISOString();
    },
  };
}

export const visibility = visibleMatterPredicate();

export function serviceOptions(clock = tickingClock()) {
  return { clock, actorUserId: ACTOR, visibility };
}

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => new Date().toISOString() });
}

// Two members, an ordinary matter, and the platform-owned custody holding matter, which carries a
// system key and must never be reachable through the log.
export function seedFirm(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  for (const [userId, displayName] of [
    [ACTOR, "Ana Ruiz"],
    [LAWYER, "Trevor Goldsmith"],
  ] as const) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${userId}', '${displayName}', 'active', '2026-08-01T00:00:00.000Z')`,
    );
  }
  const matterColumns =
    "id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at";
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${MATTER}', 'Alvarez Estate', 'open', '${ACTOR}', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${HOLDING_MATTER}', 'Custody holdings', 'open', '${ACTOR}', 'custody-holding', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z')`,
  );
}
