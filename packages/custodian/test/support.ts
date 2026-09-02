import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";

// Shared scaffolding for the Custodian package tests: a migrated in-memory per-firm database, a
// fixed clock, and the one-line commit every service test needs (the services return effects; the
// caller commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_custodyTester" as UserId;

export const clock = { now: () => "2026-08-04T12:00:00.000Z" };
export const laterClock = { now: () => "2026-09-01T09:00:00.000Z" };

export const options = { clock, actorUserId: ACTOR };

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// A firm member row, because a matter's responsible_member_id is a foreign key onto it.
// A release that satisfies the gate: it names who collected the property, the authority it left on,
// and the identity check made before it did. Every test whose subject is something ELSE (a hold, a
// report, a terminal status) uses this so the gate is not silently the thing under test.
export const AUTHORIZED_RELEASE = {
  kind: "released",
  borrower: { kind: "external", name: "A. Collector" },
  releaseAuthorization: {
    authorityBasis: "owner collecting their own original in person",
    identityEvidence: "photographic identification checked against the Directory record",
  },
} as const;

// The colleague who witnesses a two-signatory release, and one who has left the firm. Both are real
// rows in the roster the gate reads: the point of the second signatory is that it names a person, and
// a fixture that used a bare string would prove the opposite of what the tests are for.
export const WITNESS = "user_custodySecondSignatory" as UserId;
export const DEPARTED_MEMBER = "user_custodyDeparted000000" as UserId;

/**
 * The matter every packet in these tests is held under.
 *
 * A packet takes its matter at the door now — property is held for a client, and a client is
 * somebody the firm has a matter with — so a fixture without one cannot construct the thing under
 * test at all. It is a real row rather than a bare string because `custody_packet.matter_id` is a
 * foreign key: a fixture that faked it would pass here and fail against the database.
 */
export const MATTER = "matter_custodyTestMatter00" as MatterId;

/** Seed the matter packets are logged against. Depends on `seedMember` for its responsible member. */
export function seedMatter(raw: ReturnType<typeof migratedDatabase>["raw"]): MatterId {
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at)` +
      ` VALUES ('${MATTER}', 'Custody test matter', 'open', '${ACTOR}', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
  );
  return MATTER;
}

export function seedMember(raw: ReturnType<typeof migratedDatabase>["raw"]): UserId {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Custody Tester', 'active', '2026-08-04T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${WITNESS}', 'Second Signatory', 'active', '2026-08-04T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${DEPARTED_MEMBER}', 'Departed Colleague', 'deactivated', '2026-08-04T00:00:00.000Z')`,
  );
  return ACTOR;
}
