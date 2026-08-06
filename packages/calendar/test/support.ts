import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "../src/visibility.ts";

// Shared scaffolding for the calendar package tests: a migrated in-memory per-firm database, a fixed
// clock, and the one-line commit every service test needs (the services return effects; the caller
// commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_calendarTester" as UserId;
export const MATTER = "matter_calendarTest000000000000000" as MatterId;
export const WALLED_MATTER = "matter_calendarWalled0000000000000" as MatterId;
export const HOLDING_MATTER = "matter_calendarHolding000000000000" as MatterId;

export const clock = { now: () => "2026-08-06T12:00:00.000Z" };
export const visibility = visibleMatterPredicate();
export const options = { clock, actorUserId: ACTOR, visibility };

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// Three matters: an ordinary one, a second ordinary one used to prove a filter, and the
// platform-owned custody holding matter, which carries a system key and must never appear on any
// calendar read.
export function seedMatters(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Calendar Tester', 'active', '2026-08-01T00:00:00.000Z')`,
  );
  const matterColumns =
    "id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at";
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${MATTER}', 'Smith v Jones', 'open', '${ACTOR}', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${WALLED_MATTER}', 'Brown estate', 'open', '${ACTOR}', NULL, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO matter (${matterColumns}) VALUES ('${HOLDING_MATTER}', 'Custody holdings', 'open', '${ACTOR}', 'custody-holding', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z')`,
  );
}
