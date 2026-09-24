import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FirmEventId, MatterEventId, MatterId, UserId } from "@magna-carta/identifiers/types";

// Shared scaffolding for the meetings package tests: a migrated in-memory per-firm database, a fixed
// clock, and the one-line commit every service test needs (the services return effects; the caller
// commits them, so a test that forgets to commit is testing nothing).

export const HOST = "user_meetingHost0000" as UserId;
export const GUEST = "user_meetingGuest000" as UserId;

// Enough members to fill a room and then some. The cap is twelve, so thirteen is what it takes to
// prove the thirteenth person is refused rather than merely unlucky.
export const CROWD: readonly UserId[] = Array.from(
  { length: 13 },
  (_unused, index) => `user_meetingCrowd${String(index).padStart(2, "0")}` as UserId,
);

// Two matters: the ordinary one, and the platform-owned holding matter the custody register creates,
// which must never be reachable through the visible-matter predicate. The walled case is simulated
// with that row rather than with an information-barrier overlay, because the holding matter is real
// in every firm's database and the predicate already excludes it.
export const MATTER = "matter_meetingTest000000000" as MatterId;
export const HOLDING_MATTER = "matter_meetingHolding000000" as MatterId;

export const MATTER_EVENT = "matterEvent_meetingHearing0" as MatterEventId;
export const WALLED_MATTER_EVENT = "matterEvent_meetingWalled00" as MatterEventId;
export const FIRM_EVENT = "firmEvent_meetingStaff0000" as FirmEventId;

export const clock = { now: () => "2026-09-18T12:00:00.000Z" };
// A fixed instant well after every arrival a test can stage, so a meeting that ends can be asserted
// against one known value rather than against whatever a ticking clock had reached.
export const END_INSTANT = "2026-09-18T12:30:00.000Z";
export const endClock = { now: () => END_INSTANT };
export const visibility = visibleMatterPredicate();

/** The service options the member who convenes a meeting carries. */
export const options = { clock, actorUserId: HOST, visibility };

/** The same options for any other member in the room. */
export function optionsFor(userId: UserId, meetingClock: { now(): string } = clock) {
  return { clock: meetingClock, actorUserId: userId, visibility };
}

// A clock that advances a second per read, for the paths where two acts must not share an instant.
export function tickingClock(start = Date.parse("2026-09-18T12:00:00.000Z")) {
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

export function seedFirm(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  const members: readonly (readonly [UserId, string])[] = [
    [HOST, "A Host"],
    [GUEST, "A Guest"],
    ...CROWD.map((userId, index) => [userId, `Attendee ${String(index)}`] as const),
  ];
  for (const [userId, displayName] of members) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${userId}', '${displayName}', 'active', '2026-08-01T00:00:00.000Z')`,
    );
  }

  const matters: readonly (readonly [MatterId, string, string])[] = [
    [MATTER, "Herrera v Alvarez", "NULL"],
    // The platform-owned holding matter. Its system_key is exactly what the predicate excludes.
    [HOLDING_MATTER, "Custody holdings", "'custody-holding'"],
  ];
  for (const [id, title, systemKey] of matters) {
    raw.exec(
      `INSERT INTO matter (id, title, status, responsible_member_id, system_key, created_at, updated_at) ` +
        `VALUES ('${id}', '${title}', 'open', '${HOST}', ${systemKey}, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    );
  }

  const matterEvents: readonly (readonly [MatterEventId, MatterId, string])[] = [
    [MATTER_EVENT, MATTER, "Settlement conference"],
    [WALLED_MATTER_EVENT, HOLDING_MATTER, "Holding review"],
  ];
  for (const [id, matterId, title] of matterEvents) {
    raw.exec(
      `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, recorded_at, recorded_by, created_at, updated_at) ` +
        `VALUES ('${id}', '${matterId}', '${title}', 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ` +
        `'2026-09-01T00:00:00.000Z', '${HOST}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    );
  }

  raw.exec(
    `INSERT INTO firm_event (id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, audience, recorded_at, recorded_by, created_at, updated_at) ` +
      `VALUES ('${FIRM_EVENT}', 'Monday staff meeting', 'scheduled', '2026-09-21', '08:00', '08:30', 'America/Los_Angeles', 'all_members', ` +
      `'2026-09-01T00:00:00.000Z', '${HOST}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  );
}
